import type { z } from "zod"; // Assuming Zod is used for schema options

// ========================================================================
// Provider Interfaces
// ========================================================================

/**
 * Options specifically passed to the LLMProvider's execute method.
 */
export interface ProviderExecuteOptions {
	/** Override the default model for this specific API call. */
	model?: string;
	/** Sampling temperature. */
	temperature?: number;
	/** Maximum number of tokens to generate in the completion. */
	maxTokens?: number;
	/** Sequences where the API will stop generating further tokens. */
	stopSequences?: string[];
	/** A unique identifier representing your end-user, which can help providers monitor and detect abuse. */
	user?: string;
	// Add other common provider-level options as needed (e.g., topP, presencePenalty)
}

/**
 * Represents the structured response from an LLMProvider execution.
 */
export interface LLMResponse {
	/** The primary text content generated by the LLM. Null if only structured output or an error occurred. */
	text: string | null;
	/** Parsed structured output (e.g., JSON object, function call arguments) if requested and supported by the provider. */
	structuredOutput?: any; // Use 'any' for flexibility, specific providers can refine.
	/** Token usage information, if provided by the underlying API. */
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
	};
	/** Optional error information if the provider handled a partial failure. */
	error?: {
		message: string;
		code?: string | number; // Provider-specific error code
		details?: any;
	};
	/** Optional: The raw, unprocessed response object from the provider's API for debugging. */
	rawResponse?: any;
}

/**
 * Interface that all LLM providers must implement.
 * Abstracts the communication with different LLM backends.
 */
export interface LLMProvider {
	/**
	 * Executes a request to the LLM provider.
	 * @param prompt The main text prompt to send to the LLM.
	 * @param options Optional parameters to control the LLM generation for this specific call.
	 * @returns A Promise resolving to a structured LLMResponse object.
	 * @throws {Error} if a critical, unrecoverable error occurs during communication or execution.
	 */
	execute(
		prompt: string,
		options?: ProviderExecuteOptions,
	): Promise<LLMResponse>;

	/**
	 * Optional property indicating native support for structured output (like JSON mode or function calling).
	 * Libraries can use this as a hint, but primary control might still be via prompt engineering initially.
	 */
	// supportsStructuredOutput?: boolean; // Consider adding later if needed for advanced routing
}

// ========================================================================
// Library Configuration Interfaces
// ========================================================================

/** Basic logger interface */
export interface Logger {
	log: (...args: any[]) => void;
	warn: (...args: any[]) => void;
	error: (...args: any[]) => void;
}

/**
 * Overall configuration for the llmfuncs library instance or global setup.
 */
export interface LLMFuncsConfig {
	/** An instance of a class implementing the LLMProvider interface. **Required**. */
	provider: LLMProvider;

	/** Default LLM model to use if not specified per operation. */
	defaultModel?: string;
	/** Default sampling temperature (0-1/2) if not specified per operation. */
	defaultTemperature?: number;
	/** Default maximum tokens to generate if not specified per operation. */
	defaultMaxTokens?: number;

	/**
	 * Default maximum number of retries for recoverable errors encountered
	 * by the library during an operation (e.g., provider API errors, parsing failures).
	 * Defaults to 0 (no retries).
	 */
	maxRetries?: number;

	/** Default configuration for batching (used by strategies that process data in batches). */
	batching?: {
		/** Max items to include in a single batch sent to the LLM (if applicable). */
		maxItemsPerBatch: number;
	};

	/** Default configuration for parallelism when using batching strategies. */
	parallelism?: {
		/** Max number of concurrent LLM calls for batch processing. */
		maxConcurrentBatches: number;
	};

	/** Default options for the code execution sandbox (`isolated-vm`). */
	sandboxOptions?: {
		/** Default memory limit in MB for the sandbox isolate. */
		memoryLimit?: number;
		/** Default execution timeout in milliseconds for code running inside the sandbox (per call). */
		defaultTimeout?: number;
	};

	/** Optional logger instance (defaults to `console`). */
	logger?: Logger;
}

// ========================================================================
// Operation-Specific Options Interfaces
// ========================================================================

/**
 * Base options that can be passed to individual llmfuncs operations
 * to override library defaults or provide operation-specific context.
 */
export interface LLMOperationOptions {
	/** Override the default LLM model for this specific operation. */
	model?: string;
	/** Override the default temperature for this specific operation. */
	temperature?: number;
	/** Override the default maxTokens for this specific operation. */
	maxTokens?: number;
	/** Override the default number of retries for this specific operation. */
	retries?: number;

	/** A hint about the structure of items being processed (e.g., an interface definition or example). */
	itemStructureHint?: string;

	/** Override the default sandbox options for this specific operation. */
	sandbox?: {
		memoryLimit?: number;
		timeout?: number;
	};

	/** Override the default batch size for this specific operation (if applicable). */
	maxItemsPerBatch?: number;
	/** Override the default concurrency for this specific operation (if applicable). */
	maxConcurrentBatches?: number;
}

/** Options specific to the `llmMap` operation. */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export interface LLMMapOptions<O = any> extends LLMOperationOptions {
	/** Optional Zod schema to validate each element of the mapped output array. */
	outputSchema?: z.ZodSchema<O>;
}

/** Options specific to the `llmFilter` operation. */
export interface LLMFilterOptions extends LLMOperationOptions {
	// Currently no filter-specific options beyond the base, but structure allows adding later.
}

/** Options specific to the `llmReduce` operation. */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export interface LLMReduceOptions<U = any> extends LLMOperationOptions {
	/** A hint about the expected type or structure of the accumulator. */
	accumulatorTypeHint?: string;
	/** Optional Zod schema to validate the final result of the reduction. */
	finalOutputSchema?: z.ZodSchema<U>;
}

/** Options specific to the `llmSort` operation. */
export interface LLMSortOptions extends LLMOperationOptions {
	// Currently no sort-specific options beyond the base.
}

// Add more specific options interfaces for other functions (llmGroupBy, llmFind, etc.) as needed.
