import { classifyErrorKind } from '../classify-error-kind.js';

import NetTimeoutError from './net-timeout-error.js';

/**
 * Decide whether a HEAD pre-flight failure should trigger a GET retry and
 * stay OUT of `destinationCache`.
 *
 * The two contracts are intentionally tied to one helper: anything we'll GET
 * later because the HEAD answer might be wrong is also the same thing we
 * must NOT freeze into the per-session cache (or the second attempt would
 * hit the stale cached failure and skip the live retry that
 * `Crawler.#sendHeadRequest`'s `HEAD_TIMEOUT_ESCALATION_MS` is supposed to
 * pay for).
 *
 * The eligible kinds are:
 *
 * - **`NetTimeoutError`** — the HEAD pre-flight race fired without a
 *   server response. The escalating retry can still succeed against a
 *   slow-but-reachable host.
 * - **`parse-error`** — `Parse Error` / `Expected HTTP/` / `Unexpected end
 *   of stream`. Usually a middlebox rewriting / truncating the HEAD reply
 *   the GET path traverses differently.
 * - **`connection-reset`** — `ECONNRESET` / `ERR_CONNECTION_RESET` etc.
 *   middlebox dropping the connection mid-response; a retry frequently
 *   succeeds.
 *
 * Everything else — DNS, TLS, refused, blocked, plain timeout — is treated
 * as a persistent within-session verdict and IS cached so repeated calls on
 * the same host pay the network cost once.
 * @param error - The `Error` raised by the HEAD attempt.
 * @returns `true` when the error warrants a GET fallback AND a cache skip.
 * @example
 * ```ts
 * shouldGetFallbackOnHeadFailure(new NetTimeoutError(url)); // true
 * shouldGetFallbackOnHeadFailure(new Error('read ECONNRESET')); // true
 * shouldGetFallbackOnHeadFailure(new Error('Parse Error')); // true
 * shouldGetFallbackOnHeadFailure(new Error('getaddrinfo ENOTFOUND host')); // false
 * shouldGetFallbackOnHeadFailure(new Error('ERR_CERT_DATE_INVALID')); // false
 * ```
 */
export function shouldGetFallbackOnHeadFailure(error: Error): boolean {
	if (error instanceof NetTimeoutError) {
		return true;
	}
	const kind = classifyErrorKind(error.message);
	return kind === 'parse-error' || kind === 'connection-reset';
}
