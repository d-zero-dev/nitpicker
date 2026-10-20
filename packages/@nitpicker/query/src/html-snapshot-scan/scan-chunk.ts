/**
 * Distinct snapshots whose stored blobs are read per round trip; bounds the
 * stored bytes a scan holds at once. (How many of them a judge holds decoded
 * is `SCAN_BATCH_BYTES`'s concern, not this constant's.)
 * Kept in its own module so a spec can shrink it and exercise the
 * multi-chunk path without hundreds of fixture pages.
 * @example
 * walkedHashes.slice(start, start + SCAN_CHUNK);
 */
export const SCAN_CHUNK = 500;
