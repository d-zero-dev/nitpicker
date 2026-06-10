import type { ClosableBrowser } from './close-browser-safely.js';

import { closeBrowserSafely } from './close-browser-safely.js';

/**
 * Debug-style logger compatible with the `debug` package's printf-style API.
 *
 * Declared structurally so the function stays unit-testable with a `vi.fn()`
 * stub and free of a `debug` import.
 */
export type BrowserCloseLogger = (
	/** printf-style format string (e.g. `'%s'`, `'%O'`). */
	formatter: string,
	/** Arguments interpolated into the format string. */
	...args: readonly unknown[]
) => void;

/**
 * Closes a Puppeteer browser used to scrape a single URL, recording any
 * timeout fallback or unexpected cleanup error to the supplied logger.
 *
 * WHY a dedicated function: the prior inline `finally` in
 * {@link Crawler.#launchBrowserAndScrape} mixed cleanup orchestration with
 * production log formatting. Splitting it out makes the two observable
 * branches (force-kill notice and unexpected-error notice) directly testable
 * without spawning a real browser, and keeps the rule that a finally block
 * never throws: any error from {@link closeBrowserSafely} is logged here,
 * never re-thrown.
 * @param browser - The browser to close.
 * @param urlHref - URL string included in the log messages for diagnostic
 *   context.
 * @param log - Logger used to record timeout and error events.
 */
export async function handleBrowserClose(
	browser: ClosableBrowser,
	urlHref: string,
	log: BrowserCloseLogger,
): Promise<void> {
	try {
		const timedOut = await closeBrowserSafely(browser);
		if (timedOut) {
			log('Force-killed wedged Chromium browser for %s (close() timed out)', urlHref);
		}
	} catch (error) {
		log('closeBrowserSafely failed for %s: %O', urlHref, error);
	}
}
