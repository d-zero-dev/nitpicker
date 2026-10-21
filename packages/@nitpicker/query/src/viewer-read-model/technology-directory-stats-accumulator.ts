import type { TechnologyDirectoryStatsInsertRow, TechnologySourceRow } from './types.js';

import { tryParseUrl } from '@d-zero/shared/parse-url';

/**
 * Separates the directory from the technology name in a bucket key. Neither a
 * URL nor a technology name contains a NUL, so two different
 * (directory, technology) pairs never share a key.
 */
const KEY_SEPARATOR = String.fromCodePoint(0);

/** Running count for one (directory, technology) bucket. */
interface DirectoryStatsEntry {
	rootKey: string;
	directory: string;
	technology: string;
	pageCount: number;
}

/**
 * Folds `page_technologies` rows into the `viewer_technology_directory_stats`
 * buckets as they are read — one bucket per (first-path-segment directory,
 * technology), counting rows — so the build holds one entry per bucket. Why not
 * collect the rows first: there is one row (with its URL) per
 * (page, technology) pair, and nothing needs them after they are counted.
 *
 * The bucketing rule mirrors `computeDirectoryDistribution` (group by full
 * origin, then by the first non-empty `dirname` segment). A page contributes
 * one count per technology it was detected with, so a directory's buckets can
 * sum to more than its own page count. An unparseable URL is skipped
 * (defensive; every URL reaching this class already round-tripped through
 * `url_refs`).
 *
 * Rows may be added in any number of chunks; the result is the same as one
 * batch over all of them, including row order (buckets come out in the order
 * each was first seen).
 * @example
 * const stats = new TechnologyDirectoryStatsAccumulator();
 * for (const chunk of technologyRowChunks) {
 *   stats.add(chunk);
 * }
 * const rows = stats.toRows();
 */
export class TechnologyDirectoryStatsAccumulator {
	readonly #countByKey = new Map<string, DirectoryStatsEntry>();

	/**
	 * Adds a chunk of rows. The rows are read, not kept.
	 * @param rows - `page_technologies` rows joined to their page's URL.
	 */
	add(rows: readonly TechnologySourceRow[]): void {
		for (const row of rows) {
			const parsed = tryParseUrl(row.url);
			if (!parsed) {
				continue;
			}
			const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
			const origin = `${parsed.protocol}//${host}`;
			const segments = parsed.dirname
				? parsed.dirname.split('/').filter((segment) => segment.length > 0)
				: [];
			const firstSegment = segments[0];
			const directory = firstSegment ? `${origin}/${firstSegment}/` : `${origin}/`;
			const key = `${directory}${KEY_SEPARATOR}${row.technology}`;
			const existing = this.#countByKey.get(key);
			if (existing) {
				existing.pageCount += 1;
			} else {
				this.#countByKey.set(key, {
					rootKey: origin,
					directory,
					technology: row.technology,
					pageCount: 1,
				});
			}
		}
	}

	/**
	 * The `viewer_technology_directory_stats` rows for everything added so far.
	 * @returns One row per (directory, technology) bucket, in first-seen order.
	 */
	toRows(): TechnologyDirectoryStatsInsertRow[] {
		return [...this.#countByKey.values()].map((entry) => ({
			root_key: entry.rootKey,
			directory: entry.directory,
			technology: entry.technology,
			page_count: entry.pageCount,
		}));
	}
}
