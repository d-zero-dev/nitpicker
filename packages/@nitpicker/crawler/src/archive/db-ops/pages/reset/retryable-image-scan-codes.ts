/**
 * `page_meta.image_scan_desktop` / `image_scan_mobile` codes that qualify a
 * page for `--retry-failed`, mirroring `@d-zero/beholder`'s `IMAGE_SCAN_CODE`
 * (kept as a plain numeric literal list here rather than importing that
 * constant, since `@nitpicker/crawler`'s `page_meta` columns persist across
 * a `@d-zero/beholder` version bump and must keep meaning the same numbers
 * even if a future crawler build pins an older beholder).
 *
 * - `2` (`nav-unsettled`) and `3` (`frame-lost`) are transient failures the
 *   scan itself could not recover from — a retry is likely to succeed.
 * - `255` (`unknown`) is retried too, erring on the side of investigation,
 *   consistent with {@link import('../../../../classify-error-kind.js').classifyErrorKind}'s
 *   "unknown" kind never being treated as permanent.
 *
 * Deliberately excluded:
 * - `0` (`ok`) and `1` (`degraded`) — the scan produced data.
 * - `4` (`scroll-height-exceeded`) — a deterministic, page-shape-driven
 *   outcome that a retry cannot change.
 * @example
 * ```ts
 * qb.whereIn('page_meta.image_scan_desktop', RETRYABLE_IMAGE_SCAN_CODES);
 * ```
 */
export const RETRYABLE_IMAGE_SCAN_CODES = [2, 3, 255] as const;
