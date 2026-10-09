/**
 * Coarse cause of a crawl/scrape failure.
 *
 * The crawler stores only the raw error message (in `crawl_errors`,
 * `page_errors`, or `error.log`); the cause is derived on read by
 * `classifyErrorKind`, so existing archives gain classification without a
 * re-crawl.
 *
 * Owned by the archive package because the crawler (for DNS-burned host
 * caching), the archive layer itself (`--retry-failed` candidate selection)
 * and `@nitpicker/query` (for `getErrorKinds` / `getSummary`) all need to
 * classify error messages, and both crawler and query depend on archive
 * (crawler cannot depend on query).
 *
 * ### transient vs persistent
 *
 * | kind | transient? | DNS-burn? | notes |
 * | --- | --- | --- | --- |
 * | `dns` | no | yes | NXDOMAIN; the host does not resolve at all |
 * | `dns-transient` | **yes** | no | `EAI_AGAIN`; local resolver hiccup, retry often recovers |
 * | `tls` | no | no | certificate issue, usually persistent until cert rotates |
 * | `connection-refused` | mostly persistent | no | server actively rejecting on this port |
 * | `connection-reset` | yes | no | TCP reset mid-stream, often transient |
 * | `connection-timeout` | yes | no | TCP-level timeout (`ETIMEDOUT`); slow but reachable |
 * | `local-network` | **yes** | no | local machine's network is unreachable / changed (WiFi, sleep, ICMP-unreachable, …) |
 * | `parse-error` | mostly persistent | no | HTTP response could not be parsed (proxy, garbage, MITM) |
 * | `client-blocked` | persistent (per browser) | no | Chromium-side `ERR_BLOCKED_BY_*` family — the browser actively refused the request (ad/tracker heuristics, CSP, CORP, administrator block list, …) |
 * | `redirect-loop` | no | no | the redirect chain exceeded `follow-redirects`' `maxRedirects` limit — the site's own redirect configuration never converges |
 * | `protocol` | yes | no | puppeteer protocol layer (frame detached, target closed, …) |
 * | `timeout` | yes | no | puppeteer navigation timeout or HEAD pre-flight race timeout (`Timeout: <url>`) |
 * | `unknown` | unknown | no | catch-all for messages no matcher recognised |
 *
 * Only `dns` is mark-target for the DNS-burned host cache; everything else is
 * either too transient to burn (network glitch / browser hiccup) or too
 * server-specific to extrapolate to "this whole host is dead."
 *
 * ### Derived constants that MUST be reviewed when this union changes
 *
 * - `PERMANENT_ERROR_KINDS` (`permanent-error-kinds.ts`) — the set of kinds
 *   excluded from `--retry-failed` so retry iterations actually converge.
 *   A new kind that is deterministically permanent (server-state, cert,
 *   browser-block, …) likely belongs here.
 * - `PUPPETEER_FALLBACK_KINDS` (`@nitpicker/crawler`'s
 *   `crawler/is-puppeteer-fallback-candidate.ts`) — the set of kinds where
 *   one puppeteer attempt has a realistic chance of succeeding after
 *   HEAD+GET pre-flight exhausted retries. A new kind modelling a
 *   middlebox / WAF / slow-server quirk likely belongs here.
 *
 * Adding a kind without reviewing both sets risks a silent regression:
 * `--retry-failed` re-trying a permanent failure forever (no PERMANENT
 * entry), or a recoverable URL never reaching the puppeteer fallback (no
 * PUPPETEER_FALLBACK entry).
 */
export type ErrorKind =
	| 'dns'
	| 'dns-transient'
	| 'connection-refused'
	| 'connection-reset'
	| 'connection-timeout'
	| 'tls'
	| 'local-network'
	| 'parse-error'
	| 'client-blocked'
	| 'redirect-loop'
	| 'timeout'
	| 'protocol'
	| 'unknown';
