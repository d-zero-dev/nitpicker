import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/lib/**',
			// The viewer's `e2e/` specs are Playwright tests (run via
			// `yarn workspace @nitpicker/viewer test:e2e`), not Vitest. Importing
			// them under Vitest throws "Playwright Test did not expect test.describe()".
			'**/@nitpicker/viewer/e2e/**',
		],
		globalSetup: ['packages/test-server/src/__tests__/e2e/global-setup.ts'],
	},
});
