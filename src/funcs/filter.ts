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

export type FilterOptions = {
	provider?: Provider; // Made optional as it can come from global config
	batching?: {
		maxItemsPerBatch?: number;
	};
	parallelism?: {
		maxConcurrentBatches?: number;
		delayBetweenStartsMs?: number;
	};
};

type EffectiveFilterOptions = {
	provider: Provider;
	batching: EffectiveBatchingOptions;
	parallelism: EffectiveParallelismOptions;
};

export async function filter<T>(
	unfiltered: T[],
	predicate: string,
	options?: FilterOptions,
): Promise<T[]> {
	const effectiveOptions = getEffectiveOptions(options);
	const { provider, batching, parallelism } = effectiveOptions;

	if (!provider) {
		throw new Error(
			"Provider is required. Set it globally via llmfuncsConfig or pass it in options.",
		);
	}

	// If batching is not needed, run the filter without batching
	// This is a performance optimization for small arrays
	// or when maxItemsPerBatch is not set.
	if (
		!batching.maxItemsPerBatch ||
		batching.maxItemsPerBatch >= unfiltered.length
	) {
		GLOBAL_LOGGER.debug("Running filter without batching.");
		return filterSingleBatch(unfiltered, predicate, provider);
	}

	GLOBAL_LOGGER.debug(
		`Running filter with batching: maxItemsPerBatch=${batching.maxItemsPerBatch}, maxConcurrentBatches=${parallelism.maxConcurrentBatches}, delayBetweenStartsMs=${parallelism.delayBetweenStartsMs}`,
	);

	// Prepare items with original indices
	const itemsWithIndices = unfiltered.map((item, index) => ({
		item,
		originalIndex: index,
	}));

	// Create batches
	const batches: { item: T; originalIndex: number }[][] = chunk(
		itemsWithIndices,
		batching.maxItemsPerBatch,
	);

	// Define the function to process a single batch
	const processBatch = async (
		batch: { item: T; originalIndex: number }[],
		batchIndex: number,
	): Promise<number[]> => {
		GLOBAL_LOGGER.debug(
			`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} items.`,
		);

		try {
			// Extract just the items from the batch
			const batchItems = batch.map(({ item }) => item);

			// Reuse filterSingleBatch logic
			const filteredItems = await filterSingleBatch(
				batchItems,
				predicate,
				provider,
			);

			// Map back to original indices
			const matchingOriginalIndices = batch
				.filter(({ item }) => filteredItems.includes(item))
				.map(({ originalIndex }) => originalIndex);

			GLOBAL_LOGGER.debug(
				`Batch ${batchIndex + 1} completed. Found ${matchingOriginalIndices.length} matching items.`,
			);
			return matchingOriginalIndices;
		} catch (error) {
			GLOBAL_LOGGER.error(`Error processing batch ${batchIndex + 1}:`, error);
			return [];
		}
	};

	// Run batches in parallel
	const resultsPerBatch = await runBatchesInParallel(
		batches,
		processBatch,
		parallelism.maxConcurrentBatches,
		parallelism.delayBetweenStartsMs,
	);

	// Combine results (flatten the array of arrays of indices)
	const allMatchingIndices = resultsPerBatch.flat();
	const uniqueMatchingIndices = [...new Set(allMatchingIndices)]; // Ensure uniqueness

	// Filter the original array based on the collected indices
	return filterByIndices(unfiltered, uniqueMatchingIndices);
}

// Extracted original logic for the non-batching case
async function filterSingleBatch<T>(
	items: T[],
	predicate: string,
	provider: Provider,
): Promise<T[]> {
	const messages: Message[] = [
		{
			role: "user",
			content:
				"Filter the below items based on the user-provided natural language predicate. Return only the indices of items that match.",
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
	const responseText = response.text || null;
	const parsedOutput = response.structuredOutput
		? (response.structuredOutput as StructuredOutput)
		: parseResponseText(responseText);
	const filtered = filterByIndices(
		items,
		parsedOutput.items.map((item) => item.index),
	);
	return filtered;
}

function getEffectiveOptions(options?: FilterOptions): EffectiveFilterOptions {
	const config = getGlobalConfig();

	// Define defaults inline for clarity
	const defaults: Omit<EffectiveFilterOptions, "provider"> = {
		batching: {
			maxItemsPerBatch: config.batching?.maxItemsPerBatch ?? 50, // Default batch size
		},
		parallelism: {
			maxConcurrentBatches: config.parallelism?.maxConcurrentBatches ?? 5, // Default concurrency
			delayBetweenStartsMs: config.parallelism?.delayBetweenStartsMs ?? 0, // Default delay
		},
	};

	// Start with defaults, merge global config, then merge specific options
	let merged = defaults;
	if (config.batching || config.parallelism) {
		merged = deepMerge(merged, {
			batching: {
				maxItemsPerBatch: config.batching?.maxItemsPerBatch ?? 50, // Provide a default value
			},
			parallelism: {
				maxConcurrentBatches: config.parallelism?.maxConcurrentBatches ?? 5,
				delayBetweenStartsMs: config.parallelism?.delayBetweenStartsMs ?? 0,
			},
		});
	}
	if (options?.batching || options?.parallelism) {
		merged = deepMerge(merged, {
			batching: options.batching
				? {
						maxItemsPerBatch:
							options.batching.maxItemsPerBatch ??
							defaults.batching.maxItemsPerBatch,
					}
				: defaults.batching,
			parallelism: options.parallelism
				? {
						maxConcurrentBatches:
							options.parallelism.maxConcurrentBatches ??
							defaults.parallelism.maxConcurrentBatches,
						delayBetweenStartsMs:
							options.parallelism.delayBetweenStartsMs ??
							defaults.parallelism.delayBetweenStartsMs,
					}
				: defaults.parallelism,
		});
	}

	// Handle provider separately
	const provider = options?.provider ?? config.provider;
	if (!provider) {
		// This case is handled in the main function, but good practice to check
		GLOBAL_LOGGER.warn("No provider configured globally or passed in options.");
	}

	// Validate batch size
	if (merged.batching.maxItemsPerBatch <= 0) {
		throw new Error("maxItemsPerBatch must be greater than 0");
	}

	// Validate concurrency
	if (merged.parallelism.maxConcurrentBatches <= 0) {
		throw new Error("maxConcurrentBatches must be greater than 0");
	}

	if (merged.parallelism.delayBetweenStartsMs < 0) {
		throw new Error("delayBetweenStartsMs must be non-negative");
	}

	return {
		// biome-ignore lint/style/noNonNullAssertion: assert non-null, checked later
		provider: provider!,
		batching: merged.batching,
		parallelism: merged.parallelism,
	};
}

function filterByIndices<T>(unfiltered: T[], indices: number[]): T[] {
	return unfiltered.filter((_, index) => indices.includes(index));
}

function parseResponseText(responseText: string | null): StructuredOutput {
	if (responseText === null) {
		return { items: [] };
	}
	try {
		const parsed = JSON.parse(responseText);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray(parsed.items)
		) {
			return parsed;
		}
		throw new Error("Invalid response format");
	} catch (error) {
		GLOBAL_LOGGER.error("Failed to parse response text", error);
		throw new Error("Failed to parse response text");
	}
}

type StructuredOutput = {
	items: { index: number }[];
};

const structuredOutputSchema: JsonSchema = {
	type: "object",
	properties: {
		items: {
			type: "array",
			items: {
				type: "object",
				properties: {
					index: {
						type: "integer",
						description:
							"The index of the item in the original list <item index={this value}>.",
					},
				},
				required: ["index"],
			},
		},
	},
	required: ["items"],
};
