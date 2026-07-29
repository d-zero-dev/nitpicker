import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const dirname = import.meta.dirname;
const fixturePath = path.resolve(dirname, 'e2e/.fixture-inbound-links.nitpicker');
const cliBin = path.resolve(dirname, '../cli/bin/nitpicker.js');

/** Port the inbound-links-mode viewer server listens on during E2E. */
const PORT = 4329;

/**
 * Playwright configuration for the **inbound links** Viewer E2E suite.
 *
 * Sibling of `playwright.config.ts` / `playwright.stub.config.ts` /
 * `playwright.directory-tree.config.ts` / `playwright.template-clusters.config.ts`:
 * same SPA, same CLI bin, but the `webServer` points at a fixture built with
 * `e2e/generate-inbound-links-fixture.mjs`, whose viewer read model is built
 * before writing — `listInboundLinks` has no legacy fallback (unlike most
 * `viewer_*`-backed queries), so `/api/pages/inbound-links` would otherwise
 * always respond `{ available: false }` against the shared
 * `generate-fixture.mjs` fixture, which intentionally never builds the read
 * model (its own directory-tree "no read model" empty-state test depends on
 * that).
 */
if (!existsSync(fixturePath)) {
	throw new Error(
		`Inbound-links fixture not found: ${fixturePath}. Run e2e/generate-inbound-links-fixture.mjs first.`,
	);
}

export default defineConfig({
	testDir: './e2e',
	testMatch: /inbound-links\.spec\.ts$/,
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
