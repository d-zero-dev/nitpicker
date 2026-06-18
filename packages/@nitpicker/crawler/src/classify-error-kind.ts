import type { ErrorKind } from './types.js';

/**
 * Ordered message matchers. The first pattern that matches wins, so more
 * specific transport causes (DNS, TLS, connection-*) are tested before the
 * broader `protocol` / `timeout` buckets — e.g. `ETIMEDOUT` must classify as
 * `connection-timeout`, not the page-level `timeout`, and a puppeteer
 * `Protocol error` must not be swallowed by the `timeout` matcher.
 */
const MATCHERS: readonly { readonly kind: ErrorKind; readonly pattern: RegExp }[] = [
	{
		kind: 'dns',
		pattern:
			/ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i,
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
	{
		kind: 'protocol',
		pattern:
			/Protocol error|Target closed|Session closed|Execution context was destroyed|frame (?:was |got )?detached|Navigating frame was detached|Cannot find context|Node with given id|Page\.\w+ returned/i,
	},
	{
		kind: 'timeout',
		pattern:
			/Race \d|Navigation timeout|timeout of \d+\s*ms exceeded|TimeoutError|Timed out/i,
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
