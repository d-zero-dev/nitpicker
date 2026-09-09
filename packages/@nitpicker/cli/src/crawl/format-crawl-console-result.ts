import type { CrawlRuntimeOptions, CrawlRuntimeOptionsPatch } from '@nitpicker/crawler';

/**
 * Formats the status line shown in the crawl console after a command
 * successfully applies (`CrawlerOrchestrator#updateRuntimeOptions`
 * resolved). One clause per field the `patch` actually touched — a command
 * only ever sets one field, but this stays correct if that ever changes.
 *
 * An exclude-type clause reports `snapshot.addedExcludes`/`addedExcludeUrls`/
 * `addedExcludeKeywords` — the entries `applyCrawlRuntimeOptionsPatch`
 * determined were genuinely new — rather than echoing `patch.excludes`/etc.
 * back verbatim: the merge is additive-only and silently drops entries
 * already present, so an operator resubmitting an already-set pattern would
 * otherwise see "added" for something that changed nothing.
 * @param patch - The patch that was applied.
 * @param snapshot - The runtime options after applying `patch`.
 * @returns The status line, e.g. `parallels: 4` or `exclude added: /admin/** (3 total)`.
 * @example
 * ```ts
 * formatCrawlConsoleResult(
 *   { excludes: ['/admin/**'] },
 *   {
 *     parallels: 4, interval: 0,
 *     excludes: ['/a/**', '/admin/**'], excludeUrls: [], excludeKeywords: [],
 *     addedExcludes: ['/admin/**'], addedExcludeUrls: [], addedExcludeKeywords: [],
 *   },
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
			formatExcludeClause('exclude', snapshot.addedExcludes, snapshot.excludes.length),
		);
	}
	if (patch.excludeUrls) {
		clauses.push(
			formatExcludeClause(
				'exclude-url',
				snapshot.addedExcludeUrls,
				snapshot.excludeUrls.length,
			),
		);
	}
	if (patch.excludeKeywords) {
		clauses.push(
			formatExcludeClause(
				'exclude-keyword',
				snapshot.addedExcludeKeywords,
				snapshot.excludeKeywords.length,
			),
		);
	}
	return clauses.join(' / ');
}

/**
 * Builds one exclude-type clause, distinguishing "at least one pattern was
 * genuinely new" from "every submitted pattern was already present" — see
 * {@link formatCrawlConsoleResult}'s JSDoc for why that distinction matters.
 * @param label - The command name (`exclude`/`exclude-url`/`exclude-keyword`).
 * @param added - The entries actually added by this patch (may be empty).
 * @param total - The field's total entry count after the patch.
 * @returns The formatted clause.
 */
function formatExcludeClause(
	label: string,
	added: readonly string[],
	total: number,
): string {
	if (added.length === 0) {
		return `${label}: no new patterns (${total} total)`;
	}
	return `${label} added: ${added.join(', ')} (${total} total)`;
}
