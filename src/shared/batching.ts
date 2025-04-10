import type { LLMFuncsConfig } from "@/shared/config";
import { GLOBAL_LOGGER } from "@/shared/logger";

// Define more specific types for options after merging defaults
export type EffectiveBatchingOptions = Required<
	NonNullable<LLMFuncsConfig["batching"]>
>;

export type BatchResult<T> = {
	success: boolean;
	data?: T;
	error?: Error;
	retries?: number;
};

export function chunk<T>(array: T[], chunkSize: number): T[][] {
	const result: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		result.push(array.slice(i, i + chunkSize));
	}
	return result;
}

export async function runBatchesInParallel<BatchInput, BatchOutput>(
	batches: BatchInput[],
	processBatchFn: (
		batch: BatchInput,
		batchIndex: number,
	) => Promise<BatchOutput>,
	maxConcurrentBatches: number,
	delayBetweenStartsMs = 0,
	maxRetries = 3,
): Promise<BatchOutput[]> {
	const results: BatchResult<BatchOutput>[] = new Array(batches.length);
	let currentBatchIndex = 0;
	const runningPromises: Promise<void>[] = [];

	const processAndTrack = async (
		batchIndex: number,
		retryCount = 0,
	): Promise<void> => {
		try {
			GLOBAL_LOGGER.debug(
				`Processing batch ${batchIndex} (attempt ${retryCount + 1})`,
			);
			const result = await processBatchFn(batches[batchIndex], batchIndex);
			results[batchIndex] = { success: true, data: result };
		} catch (error) {
			GLOBAL_LOGGER.error(
				`Error processing batch ${batchIndex} (attempt ${retryCount + 1}):`,
				error instanceof Error ? error.message : error,
			);

			if (retryCount < maxRetries) {
				GLOBAL_LOGGER.info(`Retrying batch ${batchIndex}`);
				await new Promise((resolve) =>
					setTimeout(resolve, 1000 * (retryCount + 1)),
				);
				return processAndTrack(batchIndex, retryCount + 1);
			}

			results[batchIndex] = {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
				retries: retryCount,
			};
		}
	};

	while (currentBatchIndex < batches.length) {
		while (
			runningPromises.length < maxConcurrentBatches &&
			currentBatchIndex < batches.length
		) {
			const batchIndexToProcess = currentBatchIndex++;
			const promise = processAndTrack(batchIndexToProcess).finally(() => {
				const index = runningPromises.indexOf(promise);
				if (index > -1) {
					runningPromises.splice(index, 1);
				}
			});
			runningPromises.push(promise);

			if (currentBatchIndex < batches.length && delayBetweenStartsMs > 0) {
				await new Promise((resolve) =>
					setTimeout(resolve, delayBetweenStartsMs),
				);
			}
		}

		if (runningPromises.length >= maxConcurrentBatches) {
			await Promise.race(runningPromises);
		} else if (
			runningPromises.length === 0 &&
			currentBatchIndex >= batches.length
		) {
			// All batches dispatched and potentially completed if concurrency was low
			break;
		} else {
			// Optional small delay to prevent tight loops if Promise.race isn't needed
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
	}

	await Promise.all(runningPromises); // Wait for any remaining tasks

	// Log summary of processing
	const failed = results.filter((r) => !r.success).length;
	const succeeded = results.filter((r) => r.success).length;
	GLOBAL_LOGGER.info(
		`Batch processing complete: ${succeeded} succeeded, ${failed} failed`,
	);

	// Return successful results and log errors
	return results
		.filter((r): r is BatchResult<BatchOutput> & { success: true } => r.success)
		.map((r) => {
			if (r.data === undefined) {
				throw new Error("Unexpected undefined data in successful result.");
			}
			return r.data;
		});
}
