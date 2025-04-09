import type { JsonSchema } from "@/providers/jsonschema";
import type { Message, Provider } from "@/providers/provider";
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
 * Respects the original order of items when determining the "first" match.
 * Supports batching and parallelism for large arrays.
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
	const { provider, batching, parallelism, strategy } = effectiveOptions; // Add strategy

	if (!provider) {
		throw new Error(
			"Provider is required. Set it globally via llmfuncsConfig or pass it in options.",
		);
	}

	// If batching is not needed, run find on the whole array
	if (!batching.maxItemsPerBatch || batching.maxItemsPerBatch >= items.length) {
		GLOBAL_LOGGER.debug("Running find without batching.");
		return findSingleBatch(items, predicate, provider);
	}

	GLOBAL_LOGGER.debug(
		`Running find with batching: maxItemsPerBatch=${batching.maxItemsPerBatch}, maxConcurrentBatches=${parallelism.maxConcurrentBatches}, delayBetweenStartsMs=${parallelism.delayBetweenStartsMs}, strategy=${strategy}`, // Log strategy
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

	// Define the function to process a single batch
	// It should return the *original index* of the first found item in the batch, or -1
	const processBatch = async (
		batch: { item: T; originalIndex: number }[],
		batchIndex: number,
	): Promise<number> => {
		// Return number (-1 for not found)
		GLOBAL_LOGGER.debug(
			`Processing batch ${batchIndex + 1}/${batches.length} for find operation.`,
		);

		try {
			// Extract items and their original indices
			const batchItems = batch.map(({ item }) => item);
			const originalIndices = batch.map(({ originalIndex }) => originalIndex);

			// Find the first matching item *within this batch*
			const foundItem = await findSingleBatch(batchItems, predicate, provider);

			if (foundItem !== undefined) {
				// Find the index of the found item *within the batch*
				const indexInBatch = batchItems.findIndex(
					(item) => item === foundItem, // Simple reference check, might need deep equality for objects
				);
				if (indexInBatch !== -1) {
					// Map back to the original index
					const originalIndex = originalIndices[indexInBatch];
					GLOBAL_LOGGER.debug(
						`Batch ${batchIndex + 1} found matching item at original index ${originalIndex}.`,
					);
					return originalIndex;
				}
			}

			GLOBAL_LOGGER.debug(`Batch ${batchIndex + 1} found no matching items.`);
			return -1; // Return -1 if not found
		} catch (error) {
			GLOBAL_LOGGER.error(
				`Error processing batch ${batchIndex + 1} for find:`,
				error,
			);
			// Treat errors in a batch as if no item was found in that batch
			return -1; // Return -1 on error
		}
	};

	// Run batches in parallel
	const resultsPerBatch = await runBatchesInParallel(
		batches,
		processBatch,
		parallelism.maxConcurrentBatches,
		parallelism.delayBetweenStartsMs,
	);

	// Filter out -1s (not found)
	const foundIndices = resultsPerBatch.filter(
		(index): index is number => index !== -1,
	);

	if (foundIndices.length === 0) {
		GLOBAL_LOGGER.debug("No matching item found across all batches.");
		return undefined; // No item found in any batch
	}

	let firstMatchingIndex: number;

	if (strategy === "ordered") {
		// Find the minimum original index among all found items
		firstMatchingIndex = Math.min(...foundIndices);
		GLOBAL_LOGGER.debug(
			`Strategy 'ordered': Found first matching item overall at original index ${firstMatchingIndex}.`,
		);
	} else {
		// Strategy 'unordered': Use the first result that wasn't -1
		// Note: This depends on the order results are returned by runBatchesInParallel,
		// which corresponds to the order batches *completed*.
		firstMatchingIndex = foundIndices[0];
		GLOBAL_LOGGER.debug(
			`Strategy 'unordered': Found first matching item at original index ${firstMatchingIndex}.`,
		);
	}

	return items[firstMatchingIndex];
}

// Helper to find the first item in a smaller list (a single batch or the full list)
async function findSingleBatch<T>(
	items: T[],
	predicate: string,
	provider: Provider,
): Promise<T | undefined> {
	if (items.length === 0) {
		return undefined;
	}

	const messages: Message[] = [
		{
			role: "user",
			content:
				"Find the *first* item from the list below that matches the user-provided natural language predicate. Return only the index (integer) of the first matching item, or -1 if none match.", // Updated instruction
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

	const response = await provider.execute(messages, {
		structuredOutput: structuredOutputSchema,
	});

	let foundIndex = -1; // Default to -1 (not found)

	if (response.structuredOutput) {
		const parsedOutput = response.structuredOutput as StructuredOutput;
		// Ensure index is a number, default to -1 if missing or invalid type
		foundIndex =
			typeof parsedOutput.index === "number" ? parsedOutput.index : -1;
	} else if (response.text) {
		// Attempt to parse from text as a fallback
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

	// Check if a valid index within the bounds was found
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

	// Ensure provider is set (specific options > global config)
	const provider = options?.provider ?? config.provider;
	if (!provider) {
		// This case is handled in the main function, but good practice to check
		GLOBAL_LOGGER.warn("No provider configured globally or passed in options.");
	}

	// Final effective options, ensuring correct types and defaults
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
		strategy: mergedOptions.strategy ?? defaults.strategy, // Explicitly handle strategy default
	};

	// Validate merged values
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
