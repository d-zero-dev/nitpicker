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
	// The stub-mode, directory-tree, template-clusters-classified,
	// inbound-links, and crawl-suppression suites each have their own
	// webServer (a different fixture and port) and are wired up via
	// `playwright.stub.config.ts` / `test:e2e:stub`,
	// `playwright.directory-tree.config.ts` / `test:e2e:directory-tree`,
	// `playwright.template-clusters.config.ts` / `test:e2e:template-clusters`,
	// `playwright.inbound-links.config.ts` / `test:e2e:inbound-links`, and
	// `playwright.crawl-suppression.config.ts` / `test:e2e:crawl-suppression`.
	// Keep them out of this run so every dedicated-fixture suite stays
	// independently scheduled in CI — without this, e.g.
	// `directory-tree.spec.ts` would also run here against the shared
	// fixture, whose `/api/directory-tree` always returns an empty
	// `{ roots: [] }` (the shared fixture never builds the viewer read
	// model), and every assertion would fail.
	testIgnore:
		/(viewer-stub|directory-tree|template-clusters-classified|inbound-links|crawl-suppression)\.spec\.ts$/,
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
