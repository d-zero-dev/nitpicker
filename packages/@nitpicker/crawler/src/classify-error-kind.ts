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
		pattern:
			/ERR_CERT|ERR_SSL|\bCERT_|SSL routines|ERR_BAD_SSL|UNABLE_TO_VERIFY|unable to verify|self.signed certificate|\bERR_TLS/i,
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
	{
		kind: 'protocol',
		pattern:
			/Protocol error|Target closed|Session closed|Execution context was destroyed|frame (?:was |got )?detached|Navigating frame was detached|Cannot find context|Node with given id|Page\.\w+ returned/i,
	},
	{
		kind: 'timeout',
		// `^Timeout:` covers the NetTimeoutError "Timeout: <url>" form emitted
		// by the HEAD pre-flight race. Anchored at line start so the same
		// substring inside a longer trace ("…Timeout: the field above…") cannot
		// hijack the classification — only the bare NetTimeoutError message
		// lands here.
		pattern:
			/Race \d|Navigation timeout|timeout of \d+\s*ms exceeded|TimeoutError|Timed out|^Timeout:/i,
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
