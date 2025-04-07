import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// enable global APIs: describe(), it(), expect()...
		// Optional: set to false if you prefer importing them explicitly
		globals: true,
		// Environment for testing (e.g., 'node', 'jsdom' for browser-like env)
		environment: "node",
		// Include pattern for test files
		include: ["src/**/*.test.ts"],
		// Optional: Setup files to run before tests (e.g., for polyfills, mocks)
		// setupFiles: './src/test/setup.ts',
		// Optional: enable coverage reporting
		// coverage: {
		//   provider: 'v8', // or 'istanbul'
		//   reporter: ['text', 'json', 'html'],
		// },
		setupFiles: ["dotenv/config"], //this line,
	},
	resolve: {
		alias: [{ find: "@", replacement: resolve(__dirname, "src") }],
	},
});
