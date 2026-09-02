import type { ResetPagesByUrlsResult } from '../../../types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { dbLog } from '../../../debug.js';

import { clearPageDerivedRows } from './clear-page-derived-rows.js';

/** Row shape read from the candidate SELECT, before exclusion classification. */
interface CandidateRow {
	id: number;
	url: string;
	redirect_dest_id: number | null;
	is_skipped: number | null;
	is_external: number;
}

/**
 * Reset pages matching an operator-supplied URL list back to pending, so a
 * follow-up crawl re-fetches them from scratch — the un-scrape half of
 * `crawl --recrawl`.
 *
 * Unlike {@link resetFailedPages}, this function does not filter by prior
 * failure kind: a URL named explicitly by the operator is reset regardless
 * of what its last observation was, including a definitive `4xx`/`5xx` — the
 * whole point of `--recrawl` is to catch a page that used to 404 and is now
 * live. The only requirement on the raw candidate scan is `scraped = 1` (a
 * page never scraped has nothing to reset; it is the caller's "novel URL"
 * path instead).
 *
 * Three conservative guards then apply — matching content follows the same
 * union used to skip `resetFailedPages`'s permanent-failure filter had none:
 * a matched row is excluded (not reset) rather than silently promoted, and
 * the exclusion is reported back to the caller by category:
 *
 * - **Redirect source** (`redirect_dest_id` is set): resetting it would
 *   discard a real, previously-observed 3xx. If the operator wants the
 *   redirect re-verified, that is `--retry-failed`'s job (which does NOT
 *   exclude redirect sources from a permanent-failure reset — a different
 *   operation with a different default).
 * - **Intentionally skipped** (`is_skipped = 1`): the row was excluded by
 *   `excludes`/`excludeUrls` at ingestion or fetch time. `--recrawl` does not
 *   second-guess that configuration; re-running the crawl with a changed
 *   exclude list is the supported path to un-skip a page.
 * - **External** (`is_external = 1`): bringing a scope-external URL back
 *   into scope is `--append`'s job (`repromoteExternalPages`), which also
 *   updates the scope map. `--recrawl` only re-fetches in-scope pages.
 *
 * A URL that matches no `content_items` row at all (not yet known to the
 * archive) is silently absent from every array on the result — the caller
 * treats it as a novel URL, the same "not yet known" path `--inventory`
 * takes. A URL matching a row with `scraped = 0` is likewise absent from
 * every array: it is already pending, so there is nothing to reset.
 *
 * On a match, `content_items` is UPDATEd exactly like
 * {@link resetFailedPages} (`scraped`/`status`/`status_text`/
 * `content_type_id`/`content_length`/`header_set_id` cleared,
 * `first_crawled_at`/`last_crawled_at` preserved), and every derived row is
 * cleared via {@link clearPageDerivedRows} plus `page_errors` and
 * `analysis_violations` — the latter is not part of the shared helper
 * (`repromoteExternalPages` never clears it) but a re-fetched page's old
 * lint findings would otherwise report on HTML that no longer exists until
 * the next `analyze` run overwrites the whole table. `analysis_text_refs` is
 * a content-hash dictionary shared across pages and is not touched; an
 * orphaned entry is a harmless, unreferenced row, the same trade-off already
 * made for `page_html_blobs`.
 *
 * SELECT and UPDATE/DELETE statements are chunked to stay below SQLite's
 * `SQLITE_LIMIT_VARIABLE_NUMBER`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL strings to match against `content_items`, already in
 *   `withoutHashAndAuth` form (mirrors every other URL-list comparison in
 *   this package, e.g. `getExistingPageUrls`).
 * @param onProgress - Called after each chunk's DELETE/UPDATE statements
 *   complete, with the pages processed so far and the total to reset. Omit
 *   for no reporting (the default; e.g. tests).
 * @returns The reset URLs, plus the excluded URLs grouped by exclusion
 *   reason — see {@link ResetPagesByUrlsResult}.
 */
export async function resetPagesByUrls(
	knex: Knex,
	urls: readonly string[],
	onProgress?: (processed: number, total: number) => void,
): Promise<ResetPagesByUrlsResult> {
	const empty: ResetPagesByUrlsResult = {
		resetUrls: [],
		excludedRedirects: [],
		excludedSkipped: [],
		excludedExternal: [],
	};
	if (urls.length === 0) {
		return empty;
	}

	const candidates: CandidateRow[] = [];
	await eachSplitted([...urls], 500, async (chunk) => {
		const rows = await knex('content_items')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.select(
				'content_items.id as id',
				'url_refs.url as url',
				'content_items.redirect_dest_id as redirect_dest_id',
				'content_items.is_skipped as is_skipped',
				'content_items.is_external as is_external',
			)
			.where('content_items.scraped', 1)
			.whereIn('url_refs.url', chunk);
		candidates.push(...(rows as CandidateRow[]));
	});
	if (candidates.length === 0) {
		return empty;
	}

	const resettable: CandidateRow[] = [];
	const excludedRedirects: string[] = [];
	const excludedSkipped: string[] = [];
	const excludedExternal: string[] = [];
	for (const row of candidates) {
		if (row.redirect_dest_id != null) {
			excludedRedirects.push(row.url);
			continue;
		}
		if (row.is_skipped) {
			excludedSkipped.push(row.url);
			continue;
		}
		if (row.is_external) {
			excludedExternal.push(row.url);
			continue;
		}
		resettable.push(row);
	}

	if (resettable.length === 0) {
		return { resetUrls: [], excludedRedirects, excludedSkipped, excludedExternal };
	}

	const ids = resettable.map((row) => row.id);
	const resetUrls = resettable.map((row) => row.url);

	const chunkSize = 500;
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		await knex('content_items').whereIn('id', chunk).update({
			scraped: 0,
			status: null,
			status_text: null,
			content_type_id: null,
			content_length: null,
			header_set_id: null,
			// `first_crawled_at` / `last_crawled_at` are deliberately left
			// untouched, matching `resetFailedPages` — the last-success
			// timestamp records survive the demotion.
		});
		await knex('page_errors').whereIn('pageId', chunk).delete();
		await knex('analysis_violations').whereIn('page_id', chunk).delete();
		await clearPageDerivedRows(knex, chunk);
		onProgress?.(Math.min(i + chunkSize, ids.length), ids.length);
	}
	dbLog('Reset %d page(s) matched by URL list back to pending', resetUrls.length);
	return { resetUrls, excludedRedirects, excludedSkipped, excludedExternal };
}
