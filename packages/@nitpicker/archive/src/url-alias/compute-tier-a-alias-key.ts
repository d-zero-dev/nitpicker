import { computeAliasKeys } from '@nitpicker/core/compute-alias-keys';

/**
 * Computes the Tier A alias key for `url`: two URLs share a Tier A key when
 * they differ only by scheme (`http` vs `https` are folded together),
 * host letter-casing, or a `/index.{ext}` path suffix — differences that
 * are safe to treat as "the same resource" from the URL string alone, with
 * no need to compare rendered content.
 *
 * This is a canonical-key function, not a pairwise comparator: grouping
 * rows by exact string equality of this function's output is definitionally
 * an equivalence relation (reflexive, symmetric, transitive). A pairwise
 * "roughly equal" comparison would not be: non-transitivity is inherent to
 * pairwise comparators (see ARCHITECTURE.md's "URL の自然順は、2 件ずつ比べる
 * 比較関数ではなくバイト列キーの全順序で決める"), and does not apply to a
 * canonical-key partition like this one.
 *
 * The query string is kept in the key as written — not normalized, reordered
 * or dropped — so two URLs that differ only in their query never share a key:
 * a query-string difference is not addressed by this feature (out of scope —
 * see the `body_hash` masking, a separate content-hash-based mechanism, for
 * detecting meaningless-parameter duplicates). The fragment is left out:
 * fragments are client-side only and never affect server-rendered content.
 *
 * Each call crosses into the addon and parses the URL, and the addon builds
 * both tiers' keys from that parse: to group many pages, use
 * `groupAliasCandidates`, which parses each URL once for both keys, rather
 * than calling this and `computeTierBAliasKey` per URL.
 *
 * The key is computed in the native addon (`@nitpicker/core`,
 * `crates/nitpicker_url_key`). The JavaScript implementation
 * (`parse-alias-key-parts.ts`, `format-alias-key.ts`) is not called from here
 * and is excluded from the build: it is the oracle for
 * `compute-alias-keys.parity.spec.ts`, which pins the addon to it, and so to
 * the groupings existing archives already store (`content_items.alias_of_id`).
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
	return computeAliasKeys(url)?.tierA ?? null;
}
