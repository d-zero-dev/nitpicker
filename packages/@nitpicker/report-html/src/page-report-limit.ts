/**
 * The static HTML report's inner-page ceiling, shared by both page-selection
 * paths (`resolveDirectoryPrefixes`'s interactive `--html-dirs` narrowing and
 * `resolvePageSelection`'s non-interactive `--urls` guard) so the two can
 * never drift to different limits.
 */
export const PAGE_REPORT_LIMIT = 10_000;
