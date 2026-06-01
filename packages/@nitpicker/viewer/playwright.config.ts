import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const dirname = import.meta.dirname;
const fixturePath = path.resolve(dirname, 'e2e/.fixture.nitpicker');
const cliBin = path.resolve(dirname, '../cli/bin/nitpicker.js');

/** Port the viewer server listens on during E2E. */
const PORT = 4325;

/**
 * Playwright configuration for the Viewer E2E suite.
 *
 * The fixture `.nitpicker` is built by the `test:e2e` script
 * (`e2e/generate-fixture.mjs`) before Playwright starts; `webServer` then
 * launches the real CLI (`nitpicker viewer`) against it — so the suite
 * exercises the actual resident server + built SPA end to end.
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'list',
	webServer: {
		command: `node ${cliBin} viewer ${fixturePath} --no-open --port ${PORT}`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: false,
		timeout: 60_000,
	},
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
