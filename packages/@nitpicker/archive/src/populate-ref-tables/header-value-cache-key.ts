/**
 * Composite cache key for `header_value_refs`: hex-encoded hash + a
 * separator + raw value. Two values with the same hash but different
 * strings (astronomically improbable, but a `BLOB` hash column is not
 * a total function per SQL semantics) still resolve to distinct cache
 * entries. Shared by the cache warmer
 * ({@link ./create-header-table-caches.ts}) and the per-set upsert
 * ({@link ./upsert-one-header-set.ts}) so both sides always agree on the
 * key shape.
 * @param hash - 32-byte content hash of `value`.
 * @param value - Header value verbatim.
 * @returns Cache key string.
 * @example
 * headerValueCacheKey(computeContentHash('no-cache'), 'no-cache');
 * // '724cf9…|no-cache'
 */
export function headerValueCacheKey(hash: Buffer, value: string): string {
	return `${hash.toString('hex')}|${value}`;
}
