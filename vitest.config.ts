import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: ['**/node_modules/**', '**/dist/**', '**/lib/**'],
		globalSetup: ['packages/test-server/src/__tests__/e2e/global-setup.ts'],
	},
});
