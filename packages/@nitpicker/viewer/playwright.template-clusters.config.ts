import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const dirname = import.meta.dirname;
const fixturePath = path.resolve(dirname, 'e2e/.fixture-template-clusters.nitpicker');
const cliBin = path.resolve(dirname, '../cli/bin/nitpicker.js');

/** Port the template-clusters-mode viewer server listens on during E2E. */
const PORT = 4328;

/**
 * Playwright configuration for the **template-clusters (classified)** Viewer
 * E2E suite.
 *
 * Sibling of `playwright.config.ts` / `playwright.stub.config.ts` /
 * `playwright.directory-tree.config.ts`: same SPA, same CLI bin, but the
 * `webServer` points at a fixture built with
 * `e2e/generate-template-clusters-fixture.mjs`, which writes a
 * `page_templates` classification (one CSS-blocked cluster, one
 * path-blocked cluster) plus a dedicated stylesheet resource. Kept out of
 * the shared fixture (rather than adding a classification to it) because the
 * shared fixture's Resources / Unused Resources view assertions would then
 * have to account for the extra stylesheet — the "classification never ran"
 * fallback is covered separately in `template-clusters.spec.ts` against the
 * shared fixture, which needs no such change.
 */
if (!existsSync(fixturePath)) {
	throw new Error(
		`Template-clusters fixture not found: ${fixturePath}. Run e2e/generate-template-clusters-fixture.mjs first.`,
	);
}

export default defineConfig({
	testDir: './e2e',
	testMatch: /template-clusters-classified\.spec\.ts$/,
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
