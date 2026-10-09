import type { ErrorKind } from './types.js';

/**
 * Error kinds whose failure mode is **persistent** — re-fetching the same URL
 * (without changing the network, the certificate, the destination host, or the
 * browser's block-list state) will almost certainly produce the same failure.
 *
 * Used by `resetFailedPages` to exclude pages whose latest recorded error
 * falls in this set, so `--retry-failed` actually converges: without the
 * exclusion, NXDOMAIN / TLS mismatch / `ERR_BLOCKED_BY_CLIENT` /
 * `ECONNREFUSED` / HTTP parse-error / redirect-loop pages would be reset to
 * pending on every iteration, the crawler would re-attempt them, they would
 * fail again the same way, and the retry-target count would stay constant
 * forever.
 *
 * Why these six and not others:
 * - **dns** — `ENOTFOUND` / `ERR_NAME_NOT_RESOLVED` are authoritative DNS
 *   answers; the host is gone (or never existed). EAI_AGAIN is split out as
 *   `dns-transient` precisely so it is NOT in this set.
 * - **tls** — cert expiry / SAN mismatch / SSL protocol errors require the
 *   server operator to fix something; retrying within the same archive run
 *   cannot succeed.
 * - **client-blocked** — Chromium's `ERR_BLOCKED_*` family is a deliberate
 *   browser-side rejection; the request will be blocked identically every
 *   time the browser sees the same URL.
 * - **parse-error** — the server's HTTP response is malformed (`Expected
 *   HTTP/, RTSP/ or ICE/`, `Unexpected end of stream`). Retrying the same
 *   request hits the same parser failure.
 * - **connection-refused** — `ECONNREFUSED` is an authoritative TCP RST from
 *   the listener; either no process is listening on the port or its accept
 *   queue rejected the connection. Either way the answer is final until the
 *   server operator intervenes.
 * - **redirect-loop** — `Maximum number of redirects exceeded` /
 *   `ERR_TOO_MANY_REDIRECTS` means the site's own redirect chain never
 *   terminates; the exact same chain is served on every future fetch until
 *   the site operator fixes it.
 *
 * Notably absent (intentionally retryable):
 * - `connection-reset` / `connection-timeout` — could be middlebox or
 *   transient overload
 * - `dns-transient` (EAI_AGAIN / EREFUSED) — local resolver hiccup
 * - `local-network` — operator-side connectivity loss
 * - `timeout` — slow but reachable server (HEAD-timeout escalation gives
 *   these a real chance)
 * - `protocol` — puppeteer lifecycle race, often recovers on retry
 * - `unknown` — by definition we don't know it's permanent, so we keep
 *   retrying (errs on the side of investigating)
 */
export const PERMANENT_ERROR_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
	'dns',
	'tls',
	'client-blocked',
	'parse-error',
	'connection-refused',
	'redirect-loop',
]);
