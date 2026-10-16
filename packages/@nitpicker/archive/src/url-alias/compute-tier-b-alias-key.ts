import { computeAliasKeys } from '@nitpicker/core/compute-alias-keys';

/**
 * Computes the Tier B alias key for `url`: like `computeTierAAliasKey`,
 * but additionally strips one trailing `/` from the path (the bare root
 * path `/` is left alone). Two URLs sharing a Tier B key differ only by
 * trailing-slash presence — a resource-identity signal considerably weaker
 * than Tier A's (a web server can legitimately serve different content at
 * `/foo` and `/foo/`), so callers must additionally require a matching
 * `page_meta.body_hash` before treating a Tier B match as the same page.
 *
 * Computed in the native addon like the Tier A key — one call and one parse
 * per URL, so to group many pages use `groupAliasCandidates` — see
 * `computeTierAAliasKey` for what stays as the oracle.
 * @param url - The URL string to compute a key for.
 * @returns The Tier B key, or `null` if `url` is not a parseable http(s) URL.
 * @example
 * ```ts
 * computeTierBAliasKey('https://example.com/foo');
 * computeTierBAliasKey('https://example.com/foo/');
 * // both: 'example.com/foo' -- same key, but the caller must still confirm
 * // a matching body_hash before merging these as the same page.
 * ```
 */
export function computeTierBAliasKey(url: string): string | null {
	return computeAliasKeys(url)?.tierB ?? null;
}
