import type {
	ExecuteOptions,
	LLMResponse,
	Message,
	Provider,
} from "@/providers/provider";
import { GLOBAL_LOGGER } from "@/shared/logger";
import {
	type ContentUnion,
	type GenerateContentConfig,
	GoogleGenAI,
	type Schema,
} from "@google/genai";

export class GeminiProvider implements Provider {
	private apiKey: string;
	private client: GoogleGenAI;
	constructor(apiKey: string) {
		this.apiKey = apiKey;
		this.client = new GoogleGenAI({ apiKey: this.apiKey });
	}
	async execute(
		messages: Message[],
		options?: ExecuteOptions,
	): Promise<LLMResponse> {
		const model = options?.model || "gemini-2.0-flash-lite";
		const temperature = options?.temperature || 0.2;
		const contents: ContentUnion[] = messages.map((message) => {
			return {
				role: message.role,
				text: message.content,
			};
		});

		const config: GenerateContentConfig = { temperature };

		if (options?.maxTokens) {
			config.maxOutputTokens = options.maxTokens;
		}

		if (options?.tools && options?.tools.length > 0) {
			config.tools = [
				{
					functionDeclarations: options.tools?.map((tool) => {
						return {
							name: tool.name,
							description: tool.description,
							parameters: tool.parameters as unknown as Schema,
						};
					}),
				},
			];
		}

		if (options?.structuredOutput) {
			config.responseMimeType = "application/json";
			config.responseSchema = options.structuredOutput as unknown as Schema;
		}

		const response = await this.client.models.generateContent({
			model,
			contents,
			config,
		});

		// GLOBAL_LOGGER.debug(JSON.stringify(response, null, 2));

		const responseText = response.text || null;
		let structuredOutput: unknown | undefined;
		let error: undefined;
		try {
			structuredOutput = responseText ? JSON.parse(responseText) : undefined;
		} catch (err) {
			structuredOutput = undefined;
		}

		return {
			text: responseText,
			structuredOutput,
			error,
			rawResponse: response,
		};
	}
}
