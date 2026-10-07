/**
 * Distinct snapshots decompressed per round trip; bounds peak memory.
 * Kept in its own module so a spec can shrink it and exercise the
 * multi-chunk keyset pagination without hundreds of fixture pages.
 * @example
 * hashes.slice(0, SCAN_CHUNK);
 */
export const SCAN_CHUNK = 500;
