import type { CrawlRuntimeOptions, CrawlRuntimeOptionsPatch } from '@nitpicker/crawler';

/**
 * Formats the status line shown in the crawl console after a command
 * successfully applies (`CrawlerOrchestrator#updateRuntimeOptions`
 * resolved). One clause per field the `patch` actually touched — a command
 * only ever sets one field, but this stays correct if that ever changes.
 * @param patch - The patch that was applied.
 * @param snapshot - The runtime options after applying `patch`.
 * @returns The status line, e.g. `parallels: 4` or `exclude added: /admin/** (3 total)`.
 * @example
 * ```ts
 * formatCrawlConsoleResult(
 *   { excludes: ['/admin/**'] },
 *   { parallels: 4, interval: 0, excludes: ['/a/**', '/admin/**'], excludeUrls: [], excludeKeywords: [] },
 * );
 * // "exclude added: /admin/** (2 total)"
 * ```
 */
export function formatCrawlConsoleResult(
	patch: CrawlRuntimeOptionsPatch,
	snapshot: CrawlRuntimeOptions,
): string {
	const clauses: string[] = [];
	if (patch.parallels !== undefined) {
		clauses.push(`parallels: ${snapshot.parallels}`);
	}
	if (patch.interval !== undefined) {
		clauses.push(`interval: ${snapshot.interval}ms`);
	}
	if (patch.excludes) {
		clauses.push(
			`exclude added: ${patch.excludes.join(', ')} (${snapshot.excludes.length} total)`,
		);
	}
	if (patch.excludeUrls) {
		clauses.push(
			`exclude-url added: ${patch.excludeUrls.join(', ')} (${snapshot.excludeUrls.length} total)`,
		);
	}
	if (patch.excludeKeywords) {
		clauses.push(
			`exclude-keyword added: ${patch.excludeKeywords.join(', ')} (${snapshot.excludeKeywords.length} total)`,
		);
	}
	return clauses.join(' / ');
}
