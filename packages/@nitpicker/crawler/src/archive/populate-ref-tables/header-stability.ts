import { VOLATILE_HEADER_NAMES } from './volatile-header-names.js';

/**
 * Classifies a header name as volatile (excluded from `stable_hash`) or
 * stable (included). Names are compared case-insensitively (lower-cased
 * before lookup). Names not in {@link VOLATILE_HEADER_NAMES} default to
 * **stable** — see the docs on that constant for why this direction is
 * the safer default.
 *
 * An explicit stable list could be named instead (`content-type`,
 * `content-length`, `cache-control`, `content-security-policy`,
 * `x-frame-options`, `x-content-type-options`, `strict-transport-
 * security`, `referrer-policy`, `permissions-policy`, `server`, `vary`,
 * `location`, ...); we deliberately do NOT enumerate that set at runtime —
 * every non-volatile header is stable by construction, and enumerating
 * it would create a maintenance surface that the volatile-only lookup
 * avoids.
 * @param name - Header name (any case).
 * @returns `true` when the header is volatile.
 */
export function isVolatileHeader(name: string): boolean {
	return VOLATILE_HEADER_NAMES.has(name.toLowerCase());
}
