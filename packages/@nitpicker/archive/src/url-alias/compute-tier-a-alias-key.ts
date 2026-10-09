import { formatAliasKey } from './format-alias-key.js';
import { parseAliasKeyParts } from './parse-alias-key-parts.js';

/**
 * Computes the Tier A alias key for `url`: two URLs share a Tier A key when
 * they differ only by scheme (`http` vs `https` are folded together),
 * host letter-casing, or a `/index.{ext}` path suffix — differences that
 * are safe to treat as "the same resource" from the URL string alone, with
 * no need to compare rendered content.
 *
 * This is a canonical-key function, not a pairwise comparator: grouping
 * rows by exact string equality of this function's output is definitionally
 * an equivalence relation (reflexive, symmetric, transitive), unlike
 * `compareUrlSortKeys`'s pairwise "roughly equal" comparison (see
 * ARCHITECTURE.md's "URL natural-sort comparator は推移律を保証しない" —
 * that non-transitivity problem is inherent to pairwise comparators, and
 * does not apply to a canonical-key partition like this one).
 *
 * Deliberately does not touch the query string or fragment: a query-string
 * difference is not addressed by this feature (out of scope — see the
 * `body_hash` masking, a separate content-hash-based mechanism, for
 * detecting meaningless-parameter duplicates), and fragments are
 * client-side only and never affect server-rendered content.
 * @param url - The URL string to compute a key for.
 * @returns The Tier A key, or `null` if `url` is not a parseable http(s) URL.
 * @example
 * ```ts
 * computeTierAAliasKey('http://Example.com/about/index.html');
 * // 'example.com/about/'
 * computeTierAAliasKey('https://example.com/about/');
 * // 'example.com/about/' -- same key: scheme and /index.html are folded
 * ```
 */
export function computeTierAAliasKey(url: string): string | null {
	const parts = parseAliasKeyParts(url);
	return parts ? formatAliasKey(parts) : null;
}
