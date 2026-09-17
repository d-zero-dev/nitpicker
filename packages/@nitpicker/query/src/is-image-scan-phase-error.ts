/**
 * `@d-zero/beholder`'s `Scraper#fetchImages` prefixes every per-viewport
 * image-scan `changePhase` emission with this emoji, unconditionally, across
 * every version this package has shipped against — including the
 * `retryExhausted` message that reaches `page_errors` when a viewport's scan
 * throws (`` `📷 ${key}: skipped — ${errorMessage}` ``) or exceeds the
 * scroll-height guard. It is a stable, source-controlled marker of "this row
 * is about the image inventory scan", not a heuristic guess at message shape.
 */
const IMAGE_SCAN_MESSAGE_PREFIX = '📷 ';

/**
 * Whether a raw error message (from `page_errors`, `crawl_errors`, or
 * `error.log`) reports a beholder image-scan outcome rather than a page-fetch
 * failure.
 *
 * WHY this matters: since `@d-zero/beholder@5.0.0`, every attempted
 * image-scan outcome — including the transient navigation/frame failures
 * this message represents — is already recorded structurally per page in
 * `page_meta.image_scan_desktop` / `image_scan_mobile` (beholder's
 * `IMAGE_SCAN_CODE`). A `page_errors` row for a matching message always
 * belongs to a page whose `content_items.status` is a real HTTP response —
 * the image scan only runs after the page itself loaded. Counting the same
 * event again in {@link import('./get-error-kinds.js').getErrorKinds} would
 * misreport a successfully-fetched page as a host-level connection failure,
 * which it never was.
 *
 * Verified against `@d-zero/beholder@5.0.0`'s `Scraper#fetchImages`
 * (`scraper.ts`). `@nitpicker/query` does not depend on `@d-zero/beholder`,
 * so there is no compiler- or test-enforced link to that string — if a
 * future beholder release changes this message's wording or drops the
 * emoji, this predicate silently stops matching and the exclusion in
 * `getErrorKinds` regresses with no failing test here (this file's spec
 * only pins today's literal strings, it cannot detect upstream drift).
 * Re-check this prefix against beholder's `scraper.ts` when bumping
 * `@d-zero/beholder` in `@nitpicker/crawler`'s `package.json`.
 * @param message - The raw error message to inspect.
 * @returns `true` when the message is a beholder image-scan report.
 * @example
 * ```ts
 * isImageScanPhaseError('📷 mobile-small: skipped — Navigation timeout of 15000 ms exceeded'); // true
 * isImageScanPhaseError('Scraper.#fetchData: gave up after 3 retries — Navigation timeout of 60000 ms exceeded'); // false
 * ```
 */
export function isImageScanPhaseError(message: string): boolean {
	return message.startsWith(IMAGE_SCAN_MESSAGE_PREFIX);
}
