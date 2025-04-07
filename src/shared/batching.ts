import type { LLMFuncsConfig } from "@/shared/config";

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
