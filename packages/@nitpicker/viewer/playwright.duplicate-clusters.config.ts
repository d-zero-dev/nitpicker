import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const dirname = import.meta.dirname;
const fixturePath = path.resolve(dirname, 'e2e/.fixture-duplicate-clusters.nitpicker');
const cliBin = path.resolve(dirname, '../cli/bin/nitpicker.js');

/** Port the duplicate-clusters-mode viewer server listens on during E2E. */
const PORT = 4329;

/**
 * Playwright configuration for the **Duplicate Clusters** Viewer E2E suite
 * (issue #208).
 *
 * Sibling of `playwright.config.ts` / `playwright.template-clusters.config.ts`:
 * same SPA, same CLI bin, but the `webServer` points at a fixture built with
 * `e2e/generate-duplicate-clusters-fixture.mjs`, which writes a 12-member
 * same-`body_hash` cluster plus a `dedupe_cap_events` row. Kept out of the
 * shared fixture (rather than adding a 10+ member duplicate-body cluster to
 * it) for the same reason `template-clusters-classified.spec.ts` has its own
 * fixture — the shared fixture's other view assertions (Duplicates,
 * Resources) would otherwise have to account for the extra pages.
 */
if (!existsSync(fixturePath)) {
	throw new Error(
		`Duplicate-clusters fixture not found: ${fixturePath}. Run e2e/generate-duplicate-clusters-fixture.mjs first.`,
	);
}

export default defineConfig({
	testDir: './e2e',
	testMatch: /duplicate-clusters\.spec\.ts$/,
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
