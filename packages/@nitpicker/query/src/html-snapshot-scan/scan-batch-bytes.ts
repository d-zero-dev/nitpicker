/**
 * Estimated decoded bytes a batch of snapshots may reach before the scan
 * hands it to the judge; bounds what the judge holds at a time. A snapshot
 * that alone exceeds it is judged in a batch of its own.
 * Kept in its own module so a spec can shrink it and exercise the
 * multi-batch path without megabytes of fixtures.
 * @example
 * if (batchBytes >= SCAN_BATCH_BYTES) await flush();
 */
export const SCAN_BATCH_BYTES = 128 * 1024 * 1024;
