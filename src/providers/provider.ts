import type { JsonSchema } from "@/providers/jsonschema";

export interface Message {
	role: "user" | "assistant" | "system";
	content: string;
	toolCalls?: ToolCall[];
}

export interface Tool {
	name: string;
	description: string;
	parameters: JsonSchema;
}

export interface ToolCall {
	toolName: string;
	arguments: unknown;
}

export interface LLMResponse {
	text: string | null;
	structuredOutput?: unknown; // Use 'any' for flexibility, specific providers can refine.
	error?: {
		message: string;
		code?: string | number; // Provider-specific error code
		details?: unknown;
	};
	/** Optional: The raw, unprocessed response object from the provider's API for debugging. */
	rawResponse?: unknown;
}

export interface ExecuteOptions {
	/** Override the default model for this specific API call. */
	model?: string;
	/** Sampling temperature. */
	temperature?: number;
	/** Maximum number of tokens to generate in the completion. */
	maxTokens?: number;
	tools?: Tool[];
	structuredOutput?: JsonSchema;
}

export interface Provider {
	execute(messages: Message[], options?: ExecuteOptions): Promise<LLMResponse>;
}
