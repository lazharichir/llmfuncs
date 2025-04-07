// Deep merge utility (simplified version)
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
	const output = { ...target };
	for (const key of Object.keys(source)) {
		const targetValue = target[key as keyof T];
		const sourceValue = source[key as keyof T];

		if (isObject(targetValue) && isObject(sourceValue)) {
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			output[key as keyof T] = deepMerge(targetValue, sourceValue as any);
		} else if (sourceValue !== undefined) {
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			output[key as keyof T] = sourceValue as any;
		}
	}
	return output;
}

export function isObject(item: unknown): item is object {
	return typeof item === "object" && !Array.isArray(item);
}
