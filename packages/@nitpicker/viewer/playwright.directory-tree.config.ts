import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const dirname = import.meta.dirname;
const fixturePath = path.resolve(dirname, 'e2e/.fixture-directory-tree.nitpicker');
const cliBin = path.resolve(dirname, '../cli/bin/nitpicker.js');

/** Port the directory-tree-mode viewer server listens on during E2E. */
const PORT = 4327;

/**
 * Playwright configuration for the **directory-tree** Viewer E2E suite.
 *
 * Sibling of `playwright.config.ts` (the archive-mode config) and
 * `playwright.stub.config.ts` (the stub-mode config): same SPA, same CLI
 * bin, but the `webServer` points at a fixture built with
 * `e2e/generate-directory-tree-fixture.mjs`, whose viewer read model is
 * built before writing — the shared `generate-fixture.mjs` fixture does not
 * build the read model, so `/api/directory-tree` would always return an
 * empty `{ roots: [] }` against it. Kept in its own config (rather than
 * adding the read model build to the shared fixture) so the six other
 * views' fast-path/live dispatch in the shared-fixture suite stays
 * unaffected.
 */
if (!existsSync(fixturePath)) {
	throw new Error(
		`Directory-tree fixture not found: ${fixturePath}. Run e2e/generate-directory-tree-fixture.mjs first.`,
	);
}

export default defineConfig({
	testDir: './e2e',
	testMatch: /directory-tree\.spec\.ts$/,
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
		locale: 'en-US',
		trace: 'on-first-retry',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
