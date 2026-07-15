import type { DB_Page, PageSource } from '../../../types.js';
import type { Knex } from 'knex';

import { dbLog } from '../../../debug.js';
import { getIdByUrl } from '../../_shared/get-id-by-url.js';

/**
 * Points each redirect-source URL at the destination page, marking it scraped
 * and clearing any content it owned in a former life.
 *
 * Shared by `updatePage` (which also renders and stores the destination)
 * and `recordRedirect` (which only records the edge for a destination
 * rendered elsewhere). Self-redirects (source equal to the destination) are
 * skipped so a page is never marked as redirecting to itself — that would
 * exclude it from reports via the `whereNull('redirectDestId')` filter.
 * @param trx - The active transaction. All SQL below is executed exclusively
 *   through this transaction; there is no separate `knex` fallback because
 *   the callers (`updatePage` / `recordRedirect`) always invoke this helper
 *   from within a transaction.
 * @param sources - Redirect-source URLs (normalised): the original URL plus
 *   any intermediate hops. Empty when the page was not redirected.
 * @param destId - Database id of the redirect destination page.
 * @param destUrlNormalized - Normalised destination URL, used to detect and
 *   skip self-redirects.
 * @param isExternal - Whether the sources are external to the crawl scope.
 * @param chainLineageSource - Lineage label propagated to each intermediate
 *   hop's row (passed through to {@link getIdByUrl}). Derived by the caller
 *   from the **originating** page's source (`page.url`), not from the
 *   destination — intermediates are reached transitively from the
 *   originating render, so they inherit its lineage. Pass `'inventory-discovered'`
 *   for chains rooted at inventory-seed/discovered pages so new intermediates
 *   stay in the inventory chain; pass `'crawled'` for crawled chains so the
 *   crawled-wins downgrade inside `getIdByUrl` fires on existing
 *   `'inventory-*'` intermediates a crawled chain reaches. Pass `undefined`
 *   to fall back to the DB DEFAULT (`'crawled'`) on INSERT without
 *   triggering the downgrade on existing rows.
 */
export async function linkRedirectSources(
	trx: Knex.Transaction,
	sources: readonly string[],
	destId: number,
	destUrlNormalized: string,
	isExternal: boolean,
	chainLineageSource?: PageSource,
): Promise<void> {
	for (const redirect of sources) {
		if (redirect === destUrlNormalized) {
			dbLog('Skip self-redirect: %s', redirect);
			continue;
		}
		dbLog('Set redirected url: %s -> id:%d', redirect, destId);
		// Pass `chainLineageSource` through so a brand-new
		// intermediate hop INSERTed here inherits the originating
		// page's lineage label (inventory-discovered when the
		// originating chain is in the inventory chain, undefined
		// otherwise). The crawled-wins downgrade inside
		// `getIdByUrl` still fires when this argument is `'crawled'`,
		// matching the anchor-lineage propagation contract — an
		// existing inventory-* intermediate that is later traversed
		// by a `'crawled'` chain gets downgraded.
		const redirectId = await getIdByUrl(trx, redirect, undefined, chainLineageSource);
		await trx<DB_Page>('pages')
			.where('id', redirectId)
			.update({
				scraped: 1,
				redirectDestId: destId,
				isExternal: isExternal ? 1 : 0,
			});
		// Conditional `301 Moved Permanently` stamp — applied ONLY
		// when the row carries no definitive status yet (NULL or
		// the `-1` hard-failure sentinel). HEAD pre-flight does not
		// retain each hop's individual status code (`redirectPaths`
		// is a URL[] without statuses), so the only honest answer
		// for an unknown-status hop is "some 3xx" — 301 is the
		// canonical representative.
		//
		// We deliberately do NOT overwrite an existing definitive
		// status (200 / 302 / 307 / etc.): a row that already
		// captured a concrete status from a prior direct scrape
		// would lose accuracy. The stamp only flips two cases:
		// - NULL: a placeholder row created by `getIdByUrl`
		//   because the URL was reached only as a redirect
		//   target / source, never directly scraped. Without the
		//   stamp the row is invisible on the Errors view's status
		//   distribution.
		// - -1: a row that recorded a hard scrape failure (e.g. a
		//   puppeteer goto returned null on a HTTPS→HTTP downgrade
		//   redirect) BEFORE the chain was understood. That `-1`
		//   then conflated "real failure" with "actually a redirect
		//   source we now know about", polluting the `-1` bucket
		//   AND inflating the `--retry-failed` target (via the
		//   `whereNull('redirectDestId')` filter — the redirectDestId
		//   update above already excludes the row from retry; this
		//   stamp restores the visible identity).
		await trx<DB_Page>('pages')
			.where('id', redirectId)
			.where((qb) => qb.whereNull('status').orWhere('status', -1))
			.update({ status: 301, statusText: 'Moved Permanently' });
		// A page that used to be scraped as content can later turn into a
		// redirect source. It owns no content anymore, so drop any anchors /
		// images it captured in its former life — otherwise they linger and
		// leak into referrer / incoming-link reads (which do not filter out
		// redirect sources).
		await trx('anchors').where('pageId', redirectId).delete();
		await trx('images').where('pageId', redirectId).delete();
	}
}
