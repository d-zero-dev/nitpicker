import path from 'node:path';

import { defineConfig } from 'vitest/config';

const e2eRoot = path.resolve(
	import.meta.dirname,
	'packages/test-server/src/__tests__/e2e',
);

export default defineConfig({
	resolve: {
		alias: {
			'await-event-emitter': path.join(e2eRoot, 'await-event-emitter-shim.ts'),
		},
	},
	test: {
		include: ['packages/test-server/src/__tests__/e2e/**/*.e2e.ts'],
		testTimeout: 30_000,
		hookTimeout: 60_000,
		pool: 'forks',
		maxWorkers: 1,
		isolate: true,
		globalSetup: ['packages/test-server/src/__tests__/e2e/global-setup.ts'],
		teardownTimeout: 5000,
	},
});
