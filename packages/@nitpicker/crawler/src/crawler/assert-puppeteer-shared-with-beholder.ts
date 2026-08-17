import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPackageDir } from './find-package-dir.js';

/**
 * Verifies that crawler's own `puppeteer` install and the `puppeteer` used
 * internally by `@d-zero/beholder` resolve to the same directory on disk.
 *
 * `Crawler#scrapePage` launches the browser through crawler's own
 * `puppeteer` import and hands the resulting `Page` across the module
 * boundary into `Scraper.scrapeStart()` (`@d-zero/beholder`). If crawler's
 * pinned `puppeteer` version drifts from whatever version `@d-zero/beholder`
 * depends on internally, yarn installs two separate `puppeteer` copies and
 * the `Page` instances are structurally similar but not the same class —
 * this surfaces as a `TS2345` deep inside application code with no
 * indication that a version mismatch is the actual cause. Comparing the
 * resolved directories catches the drift directly, at the boundary where it
 * actually matters.
 * @throws {Error} When crawler's and beholder's `puppeteer` resolve to
 *   different directories, naming both.
 * @example
 * ```ts
 * import { assertPuppeteerSharedWithBeholder } from '@nitpicker/crawler';
 *
 * assertPuppeteerSharedWithBeholder();
 * ```
 */
export function assertPuppeteerSharedWithBeholder(): void {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const crawlerPuppeteerDir = findPackageDir(here, 'puppeteer');
	const beholderDir = findPackageDir(here, '@d-zero/beholder');
	const beholderPuppeteerDir = findPackageDir(beholderDir, 'puppeteer');

	if (crawlerPuppeteerDir !== beholderPuppeteerDir) {
		throw new Error(
			`crawler's puppeteer (${crawlerPuppeteerDir}) and @d-zero/beholder's puppeteer (${beholderPuppeteerDir}) resolve to different installs. ` +
				`Pin crawler's own "puppeteer" version in package.json to match the version @d-zero/beholder depends on internally.`,
		);
	}
}
