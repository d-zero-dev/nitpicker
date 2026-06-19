/**
 * Sentinel string emitted by `@d-zero/beholder`'s scraper when
 * `await page.goto(...)` resolves to `null`. Pinned here because the
 * JS-redirect rescue in `Crawler.#scrapePage` keys off the exact text —
 * an upstream rename would silently disable the rescue, but the
 * spec on this helper would also break, surfacing the drift in CI.
 */
const PAGE_GOTO_NULL_MARKER = 'Page.goto returned null';

/**
 * Decide whether a browser-scrape error message is the specific
 * `Page.goto() returned null` shape that the JS-redirect rescue is
 * designed to recover from.
 *
 * **Why this gate exists:** before the gate, the rescue fired on *any*
 * thrown error from `scraper.scrapeStart` as long as `page.url()` happened
 * to report a different http(s) URL. That made every browser failure
 * (TLS, target-crashed, OOM, navigation timeout, …) that incidentally
 * left the page on a follow-up URL look like a JS redirect, hiding the
 * real failure mode and stamping a phantom `status = 301` on the source.
 *
 * The narrow trigger only fires on the upstream's exact sentinel —
 * `Page.goto returned null` — which beholder's scraper throws *only*
 * when puppeteer's `page.goto()` resolved to `null`. Substring match (not
 * equality) so wrapped variants like `[Retried 3 times] The method
 * Page.goto returned null` (which surface in `crawl_errors` after retry
 * exhaustion at outer layers) still classify, even though the rescue
 * sees the bare form. Case-insensitive on the marker so a future
 * beholder bump that lowercases the message keeps working.
 *
 * The trigger keys off the message *string*, not the message-classifier
 * `kind`, because the rescue runs *before* the kind decision: the kind
 * classifier would already wash this into `protocol`, and `protocol`
 * covers more than just goto-null (Target closed / Session closed /
 * detached Frame …) — none of which leave puppeteer with a meaningful
 * post-navigation URL to recover.
 * @param message - The raw error message from
 *   `BrowserScrapeResult.error.message` (or any string that may carry
 *   the sentinel inside a wrapper). `null` / `undefined` returns `false`.
 * @returns `true` iff the message carries the `Page.goto returned null`
 *   sentinel.
 * @example
 * ```ts
 * isJsRedirectErrorShape('The method Page.goto returned null'); // → true
 * isJsRedirectErrorShape('Navigation timeout of 60000 ms exceeded'); // → false
 * isJsRedirectErrorShape(undefined); // → false
 * ```
 */
export function isJsRedirectErrorShape(message: string | null | undefined): boolean {
	if (typeof message !== 'string' || message === '') {
		return false;
	}
	return message.toLowerCase().includes(PAGE_GOTO_NULL_MARKER.toLowerCase());
}
