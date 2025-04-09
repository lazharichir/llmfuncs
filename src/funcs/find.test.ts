import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../providers/gemini.provider";
import { find } from "./find";

describe("find", () => {
	const provider = new GeminiProvider(process.env.GEMINI_API_KEY || "");

	it(
		"should find the first matching item without batching and parallelism",
		{ timeout: 45000 }, // Increased timeout for potentially multiple API calls
		async () => {
			// Create a larger array where the target is not in the first batch
			const items = Array.from({ length: 25 }, (_, i) => ({
				id: i + 1,
				value: `item${i + 1}`,
				isTarget: i + 1 === 17, // Target item has id 17
			}));
			const expected = items.find((item) => item.id === 17); // The item with id 17

			expect(expected).toBeDefined(); // Ensure the target exists

			const result = await find(
				items,
				"the item where isTarget is true", // Predicate to find the specific item
				{
					provider,
					batching: { maxItemsPerBatch: 5 }, // e.g., 5 batches
					parallelism: {
						maxConcurrentBatches: 2, // Run 2 batches concurrently
						delayBetweenStartsMs: 500, // Small delay
					},
				},
			);

			expect(result).toBeDefined();
			expect(result).toEqual(expected); // Should find the exact item with id 17
		},
	);

	it("should return undefined if no item matches", async () => {
		const items = [
			{ id: 1, value: "apple" },
			{ id: 2, value: "banana" },
		];
		const result = await find(items, "item with value 'grape'", { provider });
		expect(result).toBeUndefined();
	});

	it("should find the first match based on original index (no batching)", async () => {
		const items = [
			{ id: 1, type: "fruit", name: "apple" },
			{ id: 2, type: "vegetable", name: "carrot" },
			{ id: 3, type: "fruit", name: "banana" }, // First fruit
			{ id: 4, type: "fruit", name: "orange" },
		];
		const expected = items[0]; // banana is the first fruit by index
		const result = await find(items, "a fruit", { provider });
		expect(result).toEqual(expected);
	});

	it(
		"should find the first match based on original index (with batching)",
		{ timeout: 30000 },
		async () => {
			const items = [
				{ id: 1, type: "vegetable", name: "spinach" }, // Batch 1
				{ id: 2, type: "vegetable", name: "carrot" },
				{ id: 3, type: "fruit", name: "banana" }, // Batch 2 - First fruit overall
				{ id: 4, type: "vegetable", name: "broccoli" },
				{ id: 5, type: "fruit", name: "apple" }, // Batch 3
				{ id: 6, type: "fruit", name: "orange" },
			];
			const expected = items[2]; // banana is the first fruit by index

			const result = await find(items, "a fruit", {
				provider,
				batching: { maxItemsPerBatch: 2 },
				parallelism: { maxConcurrentBatches: 3 },
			});

			expect(result).toEqual(expected);
		},
	);

	it("should handle empty input array", async () => {
		const items: unknown[] = [];
		const result = await find(items, "any item", { provider });
		expect(result).toBeUndefined();
	});
});
