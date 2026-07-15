import type { DB_Page, PageSource } from '../../../types.js';
import type { Knex } from 'knex';

/**
 * Look up the `source` column of a single page by its URL key. Used by
 * the orchestrator's `PageSourceLookup` injection so the Crawler can
 * resolve a parent page's lineage on `--resume` / `--retry-failed`
 * sessions, where the in-memory `inventoryMode` is no longer
 * available but the DB still remembers what label was last persisted.
 *
 * Returns `undefined` when the URL has no `pages` row (e.g. a brand-new
 * URL that has not been seen yet) so the caller can fall through to
 * its default behaviour without distinguishing "row absent" from "row
 * present with NULL source" — the schema's `NOT NULL DEFAULT 'crawled'`
 * makes a NULL value impossible in practice.
 *
 * Read-only — no transaction, single PK-equivalent lookup on
 * `pages.url` (a UNIQUE column), so the cost is constant per call. The
 * Crawler calls this at most once per page render, NOT per
 * sub-resource, so the N+1 risk does not apply.
 * @param knex - Knex query builder connected to the archive DB.
 * @param url - URL key in `url.withoutHashAndAuth` form.
 * @returns The recorded `source`, or `undefined` when no row exists.
 */
export async function getPageSourceByUrl(
	knex: Knex,
	url: string,
): Promise<PageSource | undefined> {
	const [row] = await knex.select('source').from<DB_Page>('pages').where('url', url);
	return row?.source;
}
