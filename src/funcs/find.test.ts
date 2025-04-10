import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../providers/gemini.provider";
import { find } from "./find";

describe("find", () => {
	const provider = new GeminiProvider(process.env.GEMINI_API_KEY || "");
	const defaultTimeout = 30000; // Default timeout for API calls

	// Basic functionality tests
	it("should handle empty input array", async () => {
		const items: unknown[] = [];
		const result = await find(items, "any item", { provider });
		expect(result).toBeUndefined();
	});

	it("should return undefined if no item matches", async () => {
		const items = [
			{ id: 1, value: "apple" },
			{ id: 2, value: "banana" },
		];
		const result = await find(items, "item with value 'grape'", { provider });
		expect(result).toBeUndefined();
	});

	// Single batch test
	it(
		"should find a matching item without batching",
		{ timeout: defaultTimeout },
		async () => {
			const items = [
				{ id: 1, type: "fruit", name: "apple" },
				{ id: 2, type: "vegetable", name: "carrot" },
				{ id: 3, type: "fruit", name: "banana" },
			];

			const result = await find(items, "a fruit", { provider });

			expect(result).toBeDefined();
			expect(result?.type).toBe("fruit");
		},
	);

	// Ordered strategy test
	it(
		"should find the first matching item with ordered strategy",
		{ timeout: defaultTimeout },
		async () => {
			const items = [
				{ id: 1, type: "vegetable", name: "spinach" },
				{ id: 2, type: "vegetable", name: "carrot" },
				{ id: 3, type: "fruit", name: "banana" }, // First fruit
				{ id: 4, type: "vegetable", name: "broccoli" },
				{ id: 5, type: "fruit", name: "apple" },
			];

			const result = await find(items, "a fruit", {
				provider,
				batching: { maxItemsPerBatch: 2 },
				strategy: "ordered",
			});

			expect(result).toEqual(items[2]); // Should be banana (index 2)
		},
	);

	// Unordered strategy test
	it(
		"should find a matching item with unordered strategy",
		{ timeout: defaultTimeout },
		async () => {
			const items = [
				{ id: 1, type: "vegetable", name: "spinach" },
				{ id: 2, type: "vegetable", name: "carrot" },
				{ id: 3, type: "fruit", name: "banana" },
				{ id: 4, type: "vegetable", name: "broccoli" },
				{ id: 5, type: "fruit", name: "apple" },
			];

			const fruitItems = [items[2], items[4]]; // All fruits in the array

			const result = await find(items, "a fruit", {
				provider,
				batching: { maxItemsPerBatch: 2 },
				strategy: "unordered",
			});

			expect(result).toBeDefined();
			// With unordered, we can't guarantee which fruit will be found first
			expect(fruitItems).toContainEqual(result);
		},
	);

	// Test that demonstrates parallel batching with early return
	it(
		"should process batches in parallel and return early with unordered strategy",
		{ timeout: defaultTimeout },
		async () => {
			// Item near the end of the array that should match quickly
			const items = Array.from({ length: 15 }, (_, i) => ({
				id: i + 1,
				value: `item${i + 1}`,
				isSpecial: i + 1 === 12, // Only item 12 is special
			}));

			const expected = items.find((item) => item.isSpecial);

			const result = await find(
				items,
				"the item that has isSpecial set to true",
				{
					provider,
					batching: { maxItemsPerBatch: 3 }, // 5 batches of 3 items
					parallelism: { maxConcurrentBatches: 3 },
					strategy: "unordered", // Should return as soon as batch with item 12 completes
				},
			);

			expect(result).toEqual(expected);
		},
	);
});
