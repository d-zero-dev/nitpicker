import type { ErrorKind } from './types.js';

/**
 * Ordered message matchers. The first pattern that matches wins, so more
 * specific transport causes (DNS, TLS, connection-*) are tested before the
 * broader `protocol` / `timeout` buckets — e.g. `ETIMEDOUT` must classify as
 * `connection-timeout`, not the page-level `timeout`, and a puppeteer
 * `Protocol error` must not be swallowed by the `timeout` matcher.
 */
const MATCHERS: readonly { readonly kind: ErrorKind; readonly pattern: RegExp }[] = [
	// `dns-transient` must be evaluated before `dns`: an `EAI_AGAIN` line also
	// carries the `getaddrinfo` token, so the more specific transient pattern
	// has to win. Splitting it out from `dns` keeps the DNS-burned host cache
	// (which marks on `kind === 'dns'`) from punishing a host whose only sin
	// was a local resolver hiccup.
	{ kind: 'dns-transient', pattern: /EAI_AGAIN|\bEREFUSED\b/i },
	{
		kind: 'dns',
		pattern: /ENOTFOUND|getaddrinfo|ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i,
	},
	{
		kind: 'tls',
		// `Hostname/IP does not match certificate's altnames` is Node's
		// node:tls hostname mismatch error and is emphatically a TLS issue;
		// adding it here (alongside the OpenSSL / Chromium tokens) keeps
		// hosts that serve the wrong-name cert (common with misconfigured
		// edge / load-balancer setups) out of `unknown`. `altnames` is
		// anchored to the preceding `certificate` token so a request whose
		// error message merely mentions a path containing the substring
		// `altnames` (e.g. `https://api.example.com/altnames/lookup` in a
		// 5xx body) does NOT get misclassified into `tls` (which is a
		// `PERMANENT_ERROR_KINDS` member — a false-positive would
		// permanently exclude that page from `--retry-failed`).
		pattern:
			/ERR_CERT|ERR_SSL|\bCERT_|SSL routines|ERR_BAD_SSL|UNABLE_TO_VERIFY|unable to verify|self.signed certificate|certificate has expired\s*$|\bERR_TLS|Hostname\/IP does not match certificate|certificate'?s? altnames/i,
	},
	{ kind: 'connection-refused', pattern: /ECONNREFUSED|ERR_CONNECTION_REFUSED/i },
	{
		kind: 'connection-reset',
		pattern:
			/ECONNRESET|socket hang up|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i,
	},
	{
		kind: 'connection-timeout',
		pattern: /ETIMEDOUT|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i,
	},
	// `local-network` is evaluated AFTER the connection-* matchers so a
	// concrete cause (refused / reset / timeout) wins when both apply. Only
	// "local network is unreachable / changed" symptoms — and the OS-level
	// errors that surface them — land here. Short tokens (`EPIPE`, `EREFUSED`)
	// are word-bounded so unrelated identifiers don't false-positive.
	{
		kind: 'local-network',
		pattern:
			/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NETWORK_IO_SUSPENDED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_UNREACHABLE|ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL|ENOTCONN|\bEPIPE\b/i,
	},
	{
		kind: 'parse-error',
		pattern: /Parse Error|Expected HTTP\/|Unexpected end of stream/i,
	},
	// `follow-redirects` (pinned at 1.16.0, `fetch-destination.ts`'s HEAD/GET
	// pre-flight) throws exactly "Maximum number of redirects exceeded" —
	// no cause token, no URL — when a chain never terminates within its
	// `maxRedirects` budget. `ERR_TOO_MANY_REDIRECTS` is the equivalent
	// Chromium net-error code, covering the same symptom surfaced through a
	// puppeteer navigation instead of the Node HTTP client. Both mean the
	// SAME thing: the site's own redirect configuration loops and will loop
	// again on any future fetch, which is why this is deterministic (not a
	// transient network condition) — see `PERMANENT_ERROR_KINDS`.
	{
		kind: 'redirect-loop',
		pattern: /Maximum number of redirects exceeded|ERR_TOO_MANY_REDIRECTS/i,
	},
	// `client-blocked` covers Chromium's ERR_BLOCKED_* family — the browser
	// actively decided to reject the request (ad/tracker heuristics, CSP,
	// CORB / ORB, administrator block list, fingerprinting protection,
	// cleartext policy, …). Per the upstream `net/base/net_error_list.h`,
	// `ERR_BLOCKED_BY_CLIENT` is documented as "The client chose to block
	// the request." — i.e. the server was never the deciding party. Listed
	// before `protocol` so puppeteer's generic "Protocol error" wrapper
	// (which sometimes embeds the underlying net error code) is correctly
	// attributed to the blocked layer rather than the protocol layer.
	{
		kind: 'client-blocked',
		pattern:
			/ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_ADMINISTRATOR|ERR_BLOCKED_IN_INCOGNITO_BY_ADMINISTRATOR|ERR_BLOCKED_BY_RESPONSE|ERR_BLOCKED_BY_CSP|ERR_BLOCKED_BY_ORB|ERR_BLOCKED_BY_FINGERPRINTING_PROTECTION|ERR_CLEARTEXT_NOT_PERMITTED|ERR_NETWORK_ACCESS_REVOKED/i,
	},
	{
		kind: 'protocol',
		// `detached frame` is anchored to puppeteer's exact prefix
		// `Attempted to use detached Frame` (its current Frame.ts
		// emitter; the `i` flag below catches the lowercase variant
		// automatically), not the bare two-token substring. The bare
		// form would match unrelated diagnostics like a console message
		// "detached frame ref leaked" echoed through a logger. The older
		// Page-domain `frame (?:was |got )?detached` form is kept as a
		// separate alternative because Chromium still surfaces that
		// phrasing in some legacy code paths. Without one of these, the
		// "Attempted to use detached Frame ..." messages observed on a
		// real archive would slip into `unknown`.
		pattern:
			/Protocol error|Target closed|Session closed|Execution context was destroyed|frame (?:was |got )?detached|Attempted to use detached frame|Navigating frame was detached|Cannot find context|Node with given id|Page\.\w+ returned/i,
	},
	{
		kind: 'timeout',
		// `Timeout: https?:` matches the NetTimeoutError "Timeout: <url>"
		// form. Looking for the URL-shaped tail (rather than anchoring at
		// line start) is what lets us catch the beholder-wrapped variant
		// `[Retried N times] Timeout: https://...` that gets stored in
		// `crawl_errors` / `error.log` after retry exhaustion — the bare
		// `^Timeout:` form would only fire on the immediate failure and
		// miss every retry-exhausted record (the ones that actually land
		// in the archive). Required for slow-server timeouts that
		// previously fell into `unknown`.
		pattern:
			/Race \d|Navigation timeout|timeout of \d+\s*ms exceeded|TimeoutError|Timed out|Timeout: https?:/i,
	},
];

/**
 * Classify a raw crawler/scraper error message into a coarse {@link ErrorKind}.
 *
 * Pure and deterministic: the same message always yields the same kind, which
 * is why the kind is derived on read rather than persisted — it can be applied
 * uniformly to freshly captured `crawl_errors`, legacy `error.log` lines, and
 * `page_errors` alike.
 * @param message - The raw error message (a single line is sufficient; the
 *   cause token such as `ENOTFOUND` or `Navigation timeout` lives there).
 * @returns The matched kind, or `unknown` when no matcher applies.
 * @example
 * ```ts
 * classifyErrorKind('getaddrinfo ENOTFOUND www.example.com'); // 'dns'
 * classifyErrorKind('gave up after 3 retries — Race 180,000ms'); // 'timeout'
 * classifyErrorKind('Protocol error (Page.reload): Target closed'); // 'protocol'
 * classifyErrorKind('Maximum number of redirects exceeded'); // 'redirect-loop'
 * ```
 */
export function classifyErrorKind(message: string): ErrorKind {
	for (const { kind, pattern } of MATCHERS) {
		if (pattern.test(message)) {
			return kind;
		}
	}
	return 'unknown';
}
