import type { CrawlerOptions } from './types.js';

import { existsSync } from 'node:fs';
import path from 'node:path';

import pkg from '../../package.json' with { type: 'json' };

/**
 * Verifies that Puppeteer can resolve an installed Chrome/Chromium executable
 * before a crawl starts.
 *
 * A crawl otherwise only discovers a missing browser deep inside the
 * per-URL scrape loop (`Crawler#_launchBrowserAndScrape`), where it surfaces
 * as one more scrape error among many — the CLI still prints "Crawl
 * completed" and writes an archive, so a missing Chrome (a fatal
 * precondition, not a per-page failure) is easy to miss. Calling this once,
 * before any archive I/O begins, turns it into an immediate, actionable
 * failure instead.
 * @param executablePath - Explicit override, matching
 *   {@link CrawlerOptions.executablePath}. Pass `null` (or omit) to check
 *   Puppeteer's own pinned Chrome resolution instead.
 * @throws {Error} When the resolved executable path does not exist on disk.
 * @example
 * ```ts
 * import { assertChromeIsInstalled } from '@nitpicker/crawler';
 *
 * // Throws with install instructions before any crawl work starts.
 * await assertChromeIsInstalled();
 * ```
 */
export async function assertChromeIsInstalled(
	executablePath?: string | null,
): Promise<void> {
	if (executablePath) {
		const execPath = path.resolve(executablePath);
		if (existsSync(execPath)) {
			return;
		}
		throw new Error(`Executable path does not exist: ${execPath}`);
	}

	const puppeteer = await import('puppeteer');
	const resolvedPath = await puppeteer.executablePath();
	if (existsSync(resolvedPath)) {
		return;
	}

	const puppeteerVersion = pkg.dependencies.puppeteer;
	throw new Error(
		`Chrome executable not found at: ${resolvedPath}\n` +
			`Run \`npx puppeteer@${puppeteerVersion} browsers install chrome\` to install the Chrome build Puppeteer expects, then retry.`,
	);
}
