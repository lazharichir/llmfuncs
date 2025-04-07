import type { Provider } from "@/providers";
import { GLOBAL_LOGGER, type Logger } from "@/shared/logger";

export interface LLMFuncsConfig {
	provider?: Provider;
	logger?: Logger;
	batching?: {
		maxItemsPerBatch?: number;
	};
	parallelism?: {
		maxConcurrentBatches?: number;
		delayBetweenStartsMs?: number; // Delay before starting the next concurrent batch processing call
	};
}

const GLOBAL_CONFIG: LLMFuncsConfig = {
	logger: GLOBAL_LOGGER,
	// Default values can be set here if desired, e.g.:
	// batching: { maxItemsPerBatch: 50 },
	// parallelism: { maxConcurrentBatches: 5, delayBetweenStartsMs: 0 },
};

export const getGlobalConfig = () => GLOBAL_CONFIG;

export const llmfuncsConfig = (config: LLMFuncsConfig) => {
	Object.assign(GLOBAL_CONFIG, config);
};
