import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const dirname = import.meta.dirname;
const fixturePath = path.resolve(dirname, 'e2e/.fixture-crawl-suppression.nitpicker');
const cliBin = path.resolve(dirname, '../cli/bin/nitpicker.js');

/** Port the crawl-suppression-mode viewer server listens on during E2E. */
const PORT = 4330;

/**
 * Playwright configuration for the **Crawl Suppression** Viewer E2E suite
 * (issue #271).
 *
 * Sibling of `playwright.config.ts` / `playwright.template-clusters.config.ts`:
 * same SPA, same CLI bin, but the `webServer` points at a fixture built with
 * `e2e/generate-crawl-suppression-fixture.mjs`, which writes two
 * `dedupe_cap_events` rows (one finalized with post-hoc-marked pages, one
 * never finalized with a sample URL that was never crawled) and builds the viewer read
 * model so the "view pages" link's `/pages?dedupeCapEventId=` filter can
 * resolve via the fast path. Kept out of the shared fixture for the same
 * reason `template-clusters-classified.spec.ts` has its own — the shared
 * fixture's other view assertions would otherwise have to account for the
 * extra pages and events.
 */
if (!existsSync(fixturePath)) {
	throw new Error(
		`Crawl-suppression fixture not found: ${fixturePath}. Run e2e/generate-crawl-suppression-fixture.mjs first.`,
	);
}

export default defineConfig({
	testDir: './e2e',
	testMatch: /crawl-suppression\.spec\.ts$/,
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
