import { describe, expect, it } from "vitest"; // Only needed if globals: false
import { GeminiProvider } from "../providers/gemini.provider"; // Import functions to test
import { filter } from "./filter"; // Import functions to test

describe("filter", () => {
	const provider = new GeminiProvider(process.env.GEMINI_API_KEY || "");

	describe("batching", () => {
		it("should batch items correctly", { timeout: 30000 }, async () => {
			const items = Array.from({ length: 25 }, (_, i) => i + 1);
			const expected = items.filter((item) => item > 15);

			const result = await filter(items, "greater than 15", {
				provider,
				batching: { maxItemsPerBatch: 5 },
				parallelism: {
					maxConcurrentBatches: 2,
					delayBetweenStartsMs: 1000,
				},
			});

			expect(result.length).toBeGreaterThan(0); // Sanity check
			expect(result).toEqual(expected);
			expect(Math.max(...result)).toBeLessThanOrEqual(25); // Boundary check
			expect(Math.min(...result)).toBeGreaterThan(15); // Predicate check
		});
	});

	it("should filter numbers based on a simple predicate", async () => {
		const items = [1, 2, 3, 4, 5];
		const result = await filter(items, "greater than 2", { provider });
		expect(result).toEqual([3, 4, 5]);
	});

	it("should filter objects based on status and gender", async () => {
		const items = [
			{ name: "Alice", age: 25, status: "active" },
			{ name: "Eve", age: 45, status: "active" },
			{ name: "Mark", age: 35, status: "active" },
			{ name: "David", age: 40, status: "banned" },
			{ name: "Bob", age: 30, status: "inactive" },
			{ name: "Michael", age: 22, status: "active" },
		];
		const result = await filter(items, "male with active status", { provider });
		expect(result).toEqual([
			{ name: "Mark", age: 35, status: "active" },
			{ name: "Michael", age: 22, status: "active" },
		]);
	});
});
