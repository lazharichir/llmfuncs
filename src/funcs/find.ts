import type { JsonSchema } from "@/providers/jsonschema";
import type { Message, Provider, ExecuteOptions } from "@/providers/provider";
import {
	type EffectiveBatchingOptions,
	chunk,
	runBatchesInParallel,
} from "@/shared/batching";
import { getGlobalConfig } from "@/shared/config";
import { GLOBAL_LOGGER } from "@/shared/logger";
import type { EffectiveParallelismOptions } from "@/shared/parallelism";
import { deepMerge } from "@/shared/utils";

export type FindOptions = {
	provider?: Provider;
	batching?: {
		maxItemsPerBatch?: number;
	};
	parallelism?: {
		maxConcurrentBatches?: number;
		delayBetweenStartsMs?: number;
	};
	/**
	 * Strategy for finding the first item:
	 * - "ordered": (Slower) Guarantees finding the item with the lowest original index that matches. Processes all batches.
	 * - "unordered": (Faster) Returns the first matching item found during parallel execution, regardless of original index. Default.
	 */
	strategy?: "ordered" | "unordered";
};

type EffectiveFindOptions = {
	provider: Provider;
	batching: EffectiveBatchingOptions;
	parallelism: EffectiveParallelismOptions;
	strategy: "ordered" | "unordered";
};

// Schema for the expected structured output from the LLM
const structuredOutputSchema: JsonSchema = {
	type: "object",
	properties: {
		index: {
			type: "integer", // Use integer, -1 indicates not found
			description:
				"The index of the *first* item in the provided list that matches the predicate, or -1 if no item matches.",
		},
	},
	required: ["index"],
};

type StructuredOutput = {
	index: number; // Index or -1
};

/**
 * Finds the first item in an array that matches a natural language predicate.
 * Supports batching and parallelism for large arrays.
 * For "unordered" strategy, it returns as soon as the first match is found in any batch and attempts to cancel other ongoing batches.
 * For "ordered" strategy, it processes all batches to guarantee the lowest original index.
 */
export async function find<T>(
	items: T[],
	predicate: string,
	options?: FindOptions,
): Promise<T | undefined> {
	if (items.length === 0) {
		return undefined;
	}

	const effectiveOptions = getEffectiveOptions(options);
	const { provider, batching, parallelism, strategy } = effectiveOptions;

	if (!provider) {
		throw new Error(
			"Provider is required. Set it globally via llmfuncsConfig or pass it in options.",
		);
	}

	// If batching is not needed, run find on the whole array
	if (!batching.maxItemsPerBatch || batching.maxItemsPerBatch >= items.length) {
		GLOBAL_LOGGER.debug("Running find without batching.");
		// Pass undefined signal for single batch case
		return findSingleBatch(items, predicate, provider, undefined);
	}

	GLOBAL_LOGGER.debug(
		`Running find with batching: maxItemsPerBatch=${batching.maxItemsPerBatch}, maxConcurrentBatches=${parallelism.maxConcurrentBatches}, delayBetweenStartsMs=${parallelism.delayBetweenStartsMs}, strategy=${strategy}`,
	);

	// Prepare items with original indices
	const itemsWithIndices = items.map((item, index) => ({
		item,
		originalIndex: index,
	}));

	// Create batches
	const batches: { item: T; originalIndex: number }[][] = chunk(
		itemsWithIndices,
		batching.maxItemsPerBatch,
	);

	// --- Strategy-specific execution ---

	if (strategy === "ordered") {
		// --- Ordered Strategy: Process all batches ---
		GLOBAL_LOGGER.debug("Using 'ordered' strategy. Processing all batches.");

		// Define the function to process a single batch (returns original index or -1)
		const processBatchOrdered = async (
			batch: { item: T; originalIndex: number }[],
			batchIndex: number,
		): Promise<number> => {
			GLOBAL_LOGGER.debug(
				`Processing batch ${batchIndex + 1}/${batches.length} for find (ordered).`,
			);
			try {
				const batchItems = batch.map(({ item }) => item);
				const originalIndices = batch.map(({ originalIndex }) => originalIndex);
				// Pass undefined signal for ordered strategy batches
				const foundItem = await findSingleBatch(
					batchItems,
					predicate,
					provider,
					undefined,
				);
				if (foundItem !== undefined) {
					const indexInBatch = batchItems.findIndex(
						(item) => item === foundItem,
					);
					if (indexInBatch !== -1) {
						const originalIndex = originalIndices[indexInBatch];
						GLOBAL_LOGGER.debug(
							`Batch ${batchIndex + 1} (ordered) found match at original index ${originalIndex}.`,
						);
						return originalIndex;
					}
				}
				return -1;
			} catch (error) {
				GLOBAL_LOGGER.error(
					`Error processing batch ${batchIndex + 1} (ordered):`,
					error,
				);
				return -1;
			}
		};

		const resultsPerBatch = await runBatchesInParallel(
			batches,
			processBatchOrdered,
			parallelism.maxConcurrentBatches,
			parallelism.delayBetweenStartsMs,
		);

		const foundIndices = resultsPerBatch.filter(
			(index): index is number => index !== -1,
		);

		if (foundIndices.length === 0) {
			GLOBAL_LOGGER.debug(
				"No matching item found across all batches (ordered).",
			);
			return undefined;
		}

		const firstMatchingIndex = Math.min(...foundIndices);
		GLOBAL_LOGGER.debug(
			`Strategy 'ordered': Found first matching item overall at original index ${firstMatchingIndex}.`,
		);
		return items[firstMatchingIndex];
	}

	// --- Unordered Strategy: Return early and cancel ---
	GLOBAL_LOGGER.debug(
		"Using 'unordered' strategy. Processing batches until first match.",
	);
	const abortController = new AbortController();
	let firstMatchIndex = -1; // Shared state to track if found

	// Define the function to process a single batch (returns original index or -1)
	// Accepts AbortSignal
	const processBatchUnordered = async (
		batch: { item: T; originalIndex: number }[],
		batchIndex: number,
		signal: AbortSignal,
	): Promise<number> => {
		// Check if already aborted or found elsewhere
		if (signal.aborted || firstMatchIndex !== -1) {
			GLOBAL_LOGGER.debug(
				`Skipping batch ${batchIndex + 1} (unordered) as a match was found or aborted.`,
			);
			return -1; // Indicate skipped/aborted
		}

		GLOBAL_LOGGER.debug(
			`Processing batch ${batchIndex + 1}/${batches.length} for find (unordered).`,
		);
		try {
			const batchItems = batch.map(({ item }) => item);
			const originalIndices = batch.map(({ originalIndex }) => originalIndex);
			// Pass the signal down
			const foundItem = await findSingleBatch(
				batchItems,
				predicate,
				provider,
				signal,
			);

			// Check again after await, in case aborted during processing
			if (signal.aborted) return -1;

			if (foundItem !== undefined) {
				const indexInBatch = batchItems.findIndex((item) => item === foundItem);
				if (indexInBatch !== -1) {
					const originalIndex = originalIndices[indexInBatch];
					// Check if we are the *first* to find a match
					if (firstMatchIndex === -1) {
						firstMatchIndex = originalIndex; // Set the shared index
						GLOBAL_LOGGER.debug(
							`Batch ${batchIndex + 1} (unordered) found FIRST match at original index ${originalIndex}. Aborting others.`,
						);
						abortController.abort(); // Signal others to stop
						return originalIndex;
					}
					// Another batch finished first
					GLOBAL_LOGGER.debug(
						`Batch ${batchIndex + 1} (unordered) found match at original index ${originalIndex}, but another batch finished earlier.`,
					);
					return -1; // Indicate found, but not the first
				}
			}
			return -1; // Not found in this batch
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		} catch (error: any) {
			// Handle AbortError specifically if needed, otherwise log general errors
			if (error.name === "AbortError") {
				GLOBAL_LOGGER.debug(`Batch ${batchIndex + 1} (unordered) aborted.`);
			} else {
				GLOBAL_LOGGER.error(
					`Error processing batch ${batchIndex + 1} (unordered):`,
					error,
				);
			}
			return -1; // Treat errors as not found
		}
	};

	// Use runBatchesInParallel but pass the signal and handle early exit via abort
	// Note: runBatchesInParallel itself doesn't inherently stop early based on results,
	// but the abort signal passed to processBatchUnordered and findSingleBatch
	// allows individual tasks to terminate sooner if the provider supports it.
	// The primary mechanism for early exit here is setting firstMatchIndex and aborting.
	await runBatchesInParallel(
		batches,
		(batch, batchIndex) =>
			processBatchUnordered(batch, batchIndex, abortController.signal),
		parallelism.maxConcurrentBatches,
		parallelism.delayBetweenStartsMs,
	);

	// After all batches have been scheduled (and potentially aborted/completed)
	if (firstMatchIndex !== -1) {
		GLOBAL_LOGGER.debug(
			`Strategy 'unordered': Found first matching item at original index ${firstMatchIndex}.`,
		);
		return items[firstMatchIndex];
	}

	GLOBAL_LOGGER.debug("No matching item found across all batches (unordered).");
	return undefined;
}

// Helper to find the first item in a smaller list (a single batch or the full list)
// Now accepts an optional AbortSignal
async function findSingleBatch<T>(
	items: T[],
	predicate: string,
	provider: Provider,
	signal: AbortSignal | undefined, // Added signal parameter
): Promise<T | undefined> {
	if (items.length === 0) {
		return undefined;
	}
	// Check signal before making the call
	if (signal?.aborted) {
		throw new Error("Operation aborted"); // Or return undefined, depending on desired behavior
	}

	const messages: Message[] = [
		{
			role: "user",
			content:
				"Find the *first* item from the list below that matches the user-provided natural language predicate. Return only the index (integer) of the first matching item, or -1 if none match.",
		},
		{
			role: "user",
			content: `<predicate>${predicate}</predicate>`,
		},
		{
			role: "user",
			content: `<items>
${items.map((item, index) => `  <item index="${index}">${JSON.stringify(item)}</item>`).join("\n")}
</items>`,
		},
	];

	// Pass the signal to the provider execute options
	const executeOptions: ExecuteOptions = {
		structuredOutput: structuredOutputSchema,
		signal: signal, // Pass the signal here
	};

	const response = await provider.execute(messages, executeOptions);

	let foundIndex = -1; // Default to -1 (not found)

	if (response.structuredOutput) {
		const parsedOutput = response.structuredOutput as StructuredOutput;
		foundIndex =
			typeof parsedOutput.index === "number" ? parsedOutput.index : -1;
	} else if (response.text) {
		try {
			const parsedText = JSON.parse(response.text) as Partial<StructuredOutput>;
			if (typeof parsedText.index === "number") {
				foundIndex = parsedText.index;
			} else {
				GLOBAL_LOGGER.warn(
					"Could not parse valid index (number) from text response:",
					response.text,
				);
			}
		} catch (error) {
			GLOBAL_LOGGER.warn(
				"Failed to parse text response as JSON:",
				response.text,
				error,
			);
		}
	}

	if (foundIndex !== -1 && foundIndex >= 0 && foundIndex < items.length) {
		return items[foundIndex];
	}

	return undefined;
}

// Helper function to merge global config, defaults, and specific options
function getEffectiveOptions(options?: FindOptions): EffectiveFindOptions {
	const config = getGlobalConfig();

	const defaults: Omit<EffectiveFindOptions, "provider"> = {
		batching: {
			maxItemsPerBatch: config.batching?.maxItemsPerBatch ?? 50,
		},
		parallelism: {
			maxConcurrentBatches: config.parallelism?.maxConcurrentBatches ?? 5,
			delayBetweenStartsMs: config.parallelism?.delayBetweenStartsMs ?? 0,
		},
		strategy: "unordered", // Default strategy
	};

	// Deep merge: defaults < global config < specific options
	const mergedOptions: EffectiveFindOptions = deepMerge(
		{
			provider: null as unknown as Provider, // Temporary placeholder, will be set later
			strategy: options?.strategy ?? defaults.strategy,
			batching: {
				maxItemsPerBatch: options?.batching?.maxItemsPerBatch
					? options.batching.maxItemsPerBatch
					: defaults.batching.maxItemsPerBatch,
			},
			parallelism: {
				maxConcurrentBatches: options?.parallelism?.maxConcurrentBatches
					? options.parallelism.maxConcurrentBatches
					: defaults.parallelism.maxConcurrentBatches,
				delayBetweenStartsMs: options?.parallelism?.delayBetweenStartsMs
					? options.parallelism.delayBetweenStartsMs
					: defaults.parallelism.delayBetweenStartsMs,
			},
		},
		defaults,
	);

	const provider = options?.provider ?? config.provider;
	if (!provider) {
		GLOBAL_LOGGER.warn("No provider configured globally or passed in options.");
	}

	const effective: EffectiveFindOptions = {
		// biome-ignore lint/style/noNonNullAssertion: Provider presence is checked in the main function
		provider: provider!,
		batching: {
			maxItemsPerBatch:
				mergedOptions.batching?.maxItemsPerBatch ??
				defaults.batching.maxItemsPerBatch,
		},
		parallelism: {
			maxConcurrentBatches:
				mergedOptions.parallelism?.maxConcurrentBatches ??
				defaults.parallelism.maxConcurrentBatches,
			delayBetweenStartsMs:
				mergedOptions.parallelism?.delayBetweenStartsMs ??
				defaults.parallelism.delayBetweenStartsMs,
		},
		strategy: mergedOptions.strategy ?? defaults.strategy,
	};

	if (effective.batching.maxItemsPerBatch <= 0) {
		throw new Error("maxItemsPerBatch must be greater than 0");
	}
	if (effective.parallelism.maxConcurrentBatches <= 0) {
		throw new Error("maxConcurrentBatches must be greater than 0");
	}
	if (effective.parallelism.delayBetweenStartsMs < 0) {
		throw new Error("delayBetweenStartsMs must be non-negative");
	}
	if (!["ordered", "unordered"].includes(effective.strategy)) {
		throw new Error("strategy must be either 'ordered' or 'unordered'");
	}

	return effective;
}
