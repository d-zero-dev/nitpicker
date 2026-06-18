import type { ErrorKind } from '../types.js';

import { classifyErrorKind } from '../classify-error-kind.js';

/**
 * Error kinds where a full puppeteer navigation has a realistic chance of
 * succeeding even though the HEAD pre-flight (and its GET fallback) failed.
 *
 * These are the failure modes that a misconfigured WAF / middlebox / slow
 * origin tends to produce against a bare HEAD/GET probe while still letting
 * a real browser through — the browser uses a different request shape (full
 * navigation lifecycle, JS-capable Accept headers, real cookies, optionally
 * client TLS hints), and some hostile middleboxes only inspect the cheap
 * shape. The fallback is one attempt only; if puppeteer also fails the URL
 * is recorded as `status = -1` like before.
 *
 * Excluded kinds:
 * - **dns / dns-transient** — DNS resolution happens at the OS level before
 *   any browser request; puppeteer hits the same `getaddrinfo` outcome.
 * - **tls** — Chromium will refuse the same certificate the Node TLS stack
 *   refused (expired, wrong SAN, untrusted CA).
 * - **client-blocked** — by definition the browser is the one rejecting.
 * - **connection-refused** — TCP RST from the listener; same answer regardless
 *   of client.
 * - **connection-timeout** — `ETIMEDOUT` at the TCP connect stage means the
 *   packets never reached the host (no SYN-ACK); puppeteer issues the same
 *   `connect()` call and gets the same answer. Reserved for the middlebox
 *   case (request reached the server, response timed out), which classifies
 *   as `timeout` via the `NetTimeoutError "Timeout: <url>"` shape.
 * - **local-network** — operator-side connectivity loss; nothing on this
 *   machine will reach the host.
 * - **protocol** — puppeteer lifecycle race; bouncing back to puppeteer
 *   reproduces the same race.
 * - **unknown** — by design. Spinning up a fresh Chromium for every
 *   unclassifiable error is too expensive; if a real-world WAF / middlebox
 *   pattern lands in `unknown`, add a matcher to {@link classifyErrorKind}
 *   so it lands in one of the four included kinds above (where the fallback
 *   has a meaningful chance of succeeding) instead of widening this set.
 *
 * `PreloadShortCircuitError`'s synthesised `getaddrinfo ENOTFOUND` message
 * classifies into `dns` and is therefore filtered out automatically — no
 * separate instanceof guard is needed at the call site.
 */
const PUPPETEER_FALLBACK_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
	'timeout',
	'connection-reset',
	'parse-error',
]);

/**
 * Decide whether a failed HEAD/GET pre-flight error message warrants one
 * puppeteer fallback attempt. Pure and deterministic — the same message
 * always gives the same answer, so the decision can be unit-tested without
 * spinning up a browser.
 * @param message - The pre-flight error message (typically the last rejected
 *   `retryCall` attempt).
 * @returns `true` when puppeteer should be tried once, `false` to give up.
 * @example
 * ```ts
 * isPuppeteerFallbackCandidate('Timeout: https://slow.example.org/'); // true
 * isPuppeteerFallbackCandidate('getaddrinfo ENOTFOUND host.invalid'); // false
 * isPuppeteerFallbackCandidate('net::ERR_CERT_DATE_INVALID');         // false
 * ```
 */
export function isPuppeteerFallbackCandidate(message: string): boolean {
	return PUPPETEER_FALLBACK_KINDS.has(classifyErrorKind(message));
}
