import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../providers/gemini.provider";
import { find } from "./find";

describe("find", () => {
	const provider = new GeminiProvider(process.env.GEMINI_API_KEY || "");

	it(
		"should find items correctly with batching and parallelism",
		{ timeout: 30000 },
		async () => {
			const items = Array.from({ length: 25 }, (_, i) => ({
				id: i + 1,
				value: `item${i + 1}`,
			}));
			const expected = items.find((item) => item.id === 17);

			const result = await find(items, "item with id 17", {
				provider,
				batching: { maxItemsPerBatch: 5 },
				parallelism: {
					maxConcurrentBatches: 2,
					delayBetweenStartsMs: 1000,
				},
			});

			expect(result).toEqual(expected);
		},
	);
});
