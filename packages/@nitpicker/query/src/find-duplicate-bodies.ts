import type { DuplicateBodyEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * ASCII Unit Separator — used as the GROUP_CONCAT delimiter so the URL
 * split is unambiguous even when a URL contains commas, pipes, or any other
 * commonly-used delimiter. `\x1F` is illegal in URLs per RFC 3986, so there
 * is no realistic conflict.
 */
const URL_DELIMITER = '\u001F';

/**
 * Finds pages whose masked `<body>` content (see `computeBodyHash`) hashes
 * identically — actual content duplication, as opposed to
 * {@link import('./find-duplicates.js').findDuplicates}'s title/description
 * metadata match.
 *
 * Filters on `scraped` / `is_external` / `redirect_dest_id` the same way
 * `findDuplicates` does — deliberately, not redundantly: `body_hash` is only
 * written* for pages that had HTML rendered, but nothing clears it when a
 * page's role later changes without a fresh HTML write. A page can flip to
 * `is_external = 1` (`setExternalPage`, `writeHtml = false`) or gain a
 * `redirect_dest_id` (`linkRedirectSources`, triggered independently of
 * `writeHtml`) while keeping whatever `body_hash` it had from an earlier,
 * content-bearing visit — `content_type` is the one dimension `update-page.ts`
 * does* actively null `body_hash` for on transition, so it is not
 * re-filtered here. `content_type` itself is not filtered either: a non-null
 * `body_hash` already implies the page was HTML at write time. Grouping is
 * intentionally archive-wide (not scoped to a single host), so the same
 * content served under different hosts (or under `http` vs `https` when a
 * redirect was never set up) still surfaces as one group. HTTP status is
 * deliberately not filtered — duplicate error/soft-404 templates across
 * distinct URLs are exactly the kind of finding this function exists to
 * surface.
 * @param accessor - The archive accessor to query.
 * @param limit - Maximum number of duplicate groups to return. Defaults to 50.
 * @param offset - Number of duplicate groups (in `ORDER BY cnt DESC, body_hash
 *   ASC` order) to skip before `limit` is applied. Defaults to 0.
 * @returns An array of duplicate entries with the shared body hash and matching URLs.
 * @throws {Error} If `page_meta.body_hash` does not exist on this connection.
 *   `page_meta`'s column-add migration only runs on a writable open
 *   (`Archive.create`/`Archive.open`) — read-only connections (`query` CLI,
 *   viewer, MCP) never self-heal a legacy archive's schema. An archive that
 *   predates this feature and has never since been opened for writing
 *   (`crawl`, `crawl --append`/`--retry-failed`, `viewer-build`) genuinely
 *   lacks the column on a read-only connection, which would otherwise
 *   surface as a raw `no such column` SQL error instead of this actionable
 *   message.
 * @example
 * const groups = await findDuplicateBodies(accessor, 20);
 * for (const group of groups) {
 *   console.log(`body ${group.bodyHash} is shared by ${group.count} pages`, group.urls);
 * }
 */
export async function findDuplicateBodies(
	accessor: ArchiveAccessor,
	limit: number = 50,
	offset: number = 0,
): Promise<DuplicateBodyEntry[]> {
	const knex = accessor.getKnex();

	if (!(await knex.schema.hasColumn('page_meta', 'body_hash'))) {
		throw new Error(
			'findDuplicateBodies: this archive predates the page_meta.body_hash column. ' +
				'Run `viewer-build` (or a writable crawl: `crawl --append` / `--retry-failed`) ' +
				'against it once to add and backfill body_hash before querying duplicates.',
		);
	}

	const rows = (await knex('page_meta as pm')
		.join('content_items as ci', 'ci.id', 'pm.page_id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select(
			knex.raw('"pm"."body_hash" as bodyHash'),
			knex.raw('count(*) as cnt'),
			knex.raw('group_concat("ur"."url", ?) as urls', [URL_DELIMITER]),
		)
		.where({ 'ci.scraped': 1, 'ci.is_external': 0 })
		.whereNull('ci.redirect_dest_id')
		.whereNotNull('pm.body_hash')
		.groupBy('pm.body_hash')
		.having(knex.raw('count(*) > 1'))
		.orderBy([
			{ column: 'cnt', order: 'desc' },
			{ column: 'pm.body_hash', order: 'asc' },
		])
		.limit(limit)
		.offset(offset)) as { bodyHash: Uint8Array; cnt: number; urls: string }[];

	return rows.map((row) => ({
		bodyHash: Buffer.from(row.bodyHash).toString('hex'),
		urls: row.urls.split(URL_DELIMITER),
		count: Number(row.cnt),
	}));
}
