/** Matches only the `http:` and `https:` schemes (case-insensitive). */
const HTTP_SCHEME_PATTERN = /^https?:\/\//i;

/**
 * Canonicalise a URL for the JS-redirect identity check and return value:
 * strip credentials and fragment, normalise case / default-ports /
 * trailing-slash via the WHATWG URL parser. Returns `null` when the input
 * is unparseable.
 *
 * Used for both sides of the comparison so case-only or trailing-slash-only
 * differences (`https://Example.com` vs `https://example.com/`) do not
 * produce phantom self-redirects, and for the returned target so a pre-RFC
 * `Location: https://user:pass@host/path` is never persisted into the
 * archive with credentials (same threat model the scope-auth-leak guard
 * mitigates on the navigation side).
 * @param rawUrl - The URL string to canonicalise.
 * @returns The canonical URL string, or `null` when unparseable.
 */
function canonicaliseForComparison(rawUrl: string): string | null {
	try {
		const parsed = new URL(rawUrl);
		parsed.username = '';
		parsed.password = '';
		parsed.hash = '';
		return parsed.href;
	} catch {
		return null;
	}
}

/**
 * Decide whether a puppeteer post-navigation URL represents a real
 * client-side redirect (JS / meta-refresh) or just noise.
 *
 * **Why this helper exists:** when `page.goto()` returns `null`, the upstream
 * scraper throws `The method Page.goto returned null` — classified as
 * `protocol`, neither permanent nor a puppeteer-fallback kind, so
 * `--retry-failed` never converges. Reading `page.url()` after the throw is
 * the only way to recover the destination Chromium actually navigated to (the
 * thrown error carries no URL), so we can record the source as a redirect
 * edge instead of a hard `status = -1`. But `page.url()` can also report
 * uninformative values — `about:blank` before the first navigation completes,
 * the original URL when nothing happened — and a naive "different ?" check
 * would create a phantom redirect every time the navigation simply failed at
 * the same URL.
 *
 * The filter is intentionally narrow: anything that does not look like an
 * `http(s):` URL semantically distinct from the originally requested
 * location is discarded. Edge cases the test pins:
 *
 * - identity after URL canonicalisation (case / trailing-slash / default
 *   port / credentials / fragment) → null. WHATWG URL parsing handles
 *   `https://Example.COM` vs `https://example.com/`, `https://host:443/`
 *   vs `https://host/`, `https://u:p@host/x` vs `https://host/x`, etc.
 * - `about:blank` / `chrome-error://...` / `data:` / `file:` → null
 *   (browser-internal sentinels, never a legitimate destination)
 * - empty / whitespace string → null (defensive against
 *   `page.url()` returning `''` on a brand-new context)
 * - any genuine `http(s):` URL semantically different from the source →
 *   returned credential-/fragment-stripped (defence-in-depth against a
 *   pre-RFC server issuing `Location: https://user:pass@host/path`, which
 *   would otherwise persist credentials into the `.nitpicker` archive
 *   — exactly the leak class the scope-auth-leak guard at the navigation
 *   side blocks)
 *
 * The caller does NOT need to pre-normalise URLs — this helper normalises
 * both sides via the WHATWG URL parser before comparing. The production
 * call site passes `url.withoutHashAndAuth` for `originalUrl`, but the
 * normalisation here is idempotent so passing `url.href` would also work.
 * @param originalUrl - The URL puppeteer was asked to navigate to.
 * @param postNavigationUrl - The URL reported by `page.url()` after the
 *   throw. May be `null` / `undefined` when reading the URL itself failed.
 * @returns The credential-/fragment-stripped post-navigation URL when it
 *   represents a real JS redirect, otherwise `null`.
 * @example
 * ```ts
 * deriveJsRedirectTarget(
 *   'https://www.example.com/old',
 *   'https://www.example.com/new',
 * ); // → 'https://www.example.com/new'
 *
 * deriveJsRedirectTarget('https://www.example.com/old', 'about:blank');
 * // → null
 *
 * // Case / trailing-slash noise — no phantom self-redirect:
 * deriveJsRedirectTarget(
 *   'https://www.example.com',
 *   'https://www.example.com/',
 * ); // → null
 *
 * // Credentials in destination — stripped before return:
 * deriveJsRedirectTarget(
 *   'https://www.example.com/',
 *   'https://user:pass@www.example.com/dest',
 * ); // → 'https://www.example.com/dest'
 * ```
 */
export function deriveJsRedirectTarget(
	originalUrl: string,
	postNavigationUrl: string | null | undefined,
): string | null {
	if (typeof postNavigationUrl !== 'string') {
		return null;
	}
	const trimmed = postNavigationUrl.trim();
	if (trimmed === '') {
		return null;
	}
	// Browser-internal sentinels: `about:blank` appears before the first
	// navigation completes, `chrome-error://...` after a network error
	// renders the Chromium error page, and `data:` / `file:` / `javascript:`
	// can never be the destination of an off-page redirect we want to record.
	// `http:` / `https:` is the only safe positive match.
	if (!HTTP_SCHEME_PATTERN.test(trimmed)) {
		return null;
	}
	const destinationCanonical = canonicaliseForComparison(trimmed);
	if (destinationCanonical === null) {
		return null;
	}
	const originalCanonical = canonicaliseForComparison(originalUrl);
	// `originalCanonical === null` only happens for a degenerate (unparseable)
	// `originalUrl` — fall back to a raw string check so we never claim a
	// redirect we cannot prove. The production call site always supplies a
	// parseable form.
	if (originalCanonical === null) {
		return trimmed === originalUrl ? null : destinationCanonical;
	}
	if (destinationCanonical === originalCanonical) {
		return null;
	}
	return destinationCanonical;
}
