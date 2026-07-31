import type {
	DuplicateBodyClusterEntry,
	ListDuplicateBodyClustersOptions,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeDirectoryDistribution } from './compute-directory-distribution.js';
import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';

const DEFAULT_MIN_COUNT = 10;
const DEFAULT_LIMIT = 50;
const DEFAULT_SAMPLE_PAGES_LIMIT = 20;

/**
 * Lists same-`body_hash` clusters filtered and ranked for the "is this a
 * same-cluster trap" question (issue #208), on top of
 * {@link import('./find-duplicate-bodies.js').findDuplicateBodies}'s raw
 * grouping.
 *
 * A new function rather than extending `findDuplicateBodies`: that
 * function's `{bodyHash, urls, count}` contract already has CLI/MCP
 * consumers expecting every member URL back, so adding a `minCount` filter,
 * a title-uniformity requirement, and a trap-oriented sort there would be a
 * breaking change for them. This function reuses `body_hash` as-is for its
 * `signature` (issue #208 originally proposed defining a new hash for this —
 * unnecessary, since `body_hash` already is one) and needs no additional
 * JOIN beyond what `findDuplicateBodies` already uses: `title_text_id` and
 * `og_url_id` are both already columns on `page_meta`.
 *
 * **Two-stage query, not one**: a single `GROUP_CONCAT` (as
 * `findDuplicateBodies` uses) cannot express "first N URLs per group" —
 * SQLite's `GROUP_CONCAT` has no `ORDER BY ... LIMIT` inside the aggregate.
 * Stage 1 computes the filtered/ranked cluster list from aggregate columns
 * only (no per-row URL data). Stage 2 then fetches every member URL for
 * every surviving cluster in a single `whereIn(body_hash, ...)` query
 * (grouped back into per-cluster lists in memory afterward, not one query
 * per cluster) — needed in full (not just `samplePagesLimit`) because
 * `commonDirectories` must reflect the true distribution across the whole
 * cluster (see `computeDirectoryDistribution`'s own JSDoc on why a partial
 * sample would misrepresent a multi-section trap). `samplePages` is then a
 * plain in-memory slice of that same fetch. Splitting into two stages keeps
 * stage 1's `GROUP BY` from ever materialising a member URL list only to
 * discard everything past `limit` clusters.
 *
 * **Title-uniformity filter uses `COALESCE(title_text_id, -1)`, not the raw
 * column**: `COUNT(DISTINCT title_text_id)` ignores `NULL`s, so a cluster
 * where every member page lacks a `<title>` (all `NULL`) would otherwise
 * evaluate to `0`, failing a plain `= 1` check even though every member
 * agrees (on having no title). Coalescing to a sentinel keeps that case
 * indistinguishable from "everyone has the same real title".
 *
 * **`og:url` mismatch is a ratio, not a boolean**: "does this cluster's
 * `og:url` point elsewhere" is a per-page fact, and a cluster's members do
 * not always agree — expressing it as
 * `SUM(mismatch ? 1 : 0) / COUNT(*)` (rather than an ANY/ALL boolean)
 * avoids having to define which of those two the boolean would mean.
 *
 * Applies the same `alias_of_id` filter `findDuplicates` uses (unlike
 * `findDuplicateBodies`, which omits it — see that function's own JSDoc):
 * a Tier B alias pair is defined by matching `title_text_id` AND
 * `body_hash`, so an alias pair would otherwise always surface here as a
 * (spurious) 2-page cluster.
 * @param accessor - The archive accessor to query.
 * @param options - See {@link ListDuplicateBodyClustersOptions}.
 * @returns Clusters ranked by `ogUrlMismatchRatio` descending, then `count`
 *   descending, then `signature` ascending (deterministic tie-break).
 * @throws {Error} If `page_meta.body_hash` does not exist on this connection
 *   (see `findDuplicateBodies`'s matching throw for the same reasoning), or
 *   if `content_items.alias_of_id` does not exist (see
 *   `requireAliasOfIdColumn`).
 * @example
 * ```ts
 * const clusters = await listDuplicateBodyClusters(accessor, { minCount: 100 });
 * for (const cluster of clusters) {
 *   console.log(`${cluster.count} pages, og:url mismatch ${cluster.ogUrlMismatchRatio}`);
 * }
 * ```
 */
export async function listDuplicateBodyClusters(
	accessor: ArchiveAccessor,
	options: ListDuplicateBodyClustersOptions = {},
): Promise<DuplicateBodyClusterEntry[]> {
	const knex = accessor.getKnex();

	if (!(await knex.schema.hasColumn('page_meta', 'body_hash'))) {
		throw new Error(
			'listDuplicateBodyClusters: this archive predates the page_meta.body_hash column. ' +
				'Run `viewer-build` (or a writable crawl: `crawl --append` / `--retry-failed`) ' +
				'against it once to add and backfill body_hash before querying clusters.',
		);
	}
	await requireAliasOfIdColumn(knex);

	const minCount = options.minCount ?? DEFAULT_MIN_COUNT;
	const limit = options.limit ?? DEFAULT_LIMIT;
	const offset = options.offset ?? 0;
	const samplePagesLimit = options.samplePagesLimit ?? DEFAULT_SAMPLE_PAGES_LIMIT;

	// Stage 1: aggregate-only. No URL data yet — see this function's JSDoc
	// for why fetching URLs here would waste work on clusters `HAVING`/`LIMIT`
	// later discard.
	const clusterRows = (await knex('page_meta as pm')
		.join('content_items as ci', 'ci.id', 'pm.page_id')
		.select(
			knex.raw('"pm"."body_hash" as bodyHash'),
			knex.raw('count(*) as cnt'),
			knex.raw(
				'cast(sum(case when "pm"."og_url_id" is not null and "pm"."og_url_id" != "ci"."url_id" then 1 else 0 end) as real) / count(*) as ogUrlMismatchRatio',
			),
		)
		.where({ 'ci.scraped': 1, 'ci.is_external': 0 })
		.whereNull('ci.redirect_dest_id')
		.whereNull('ci.alias_of_id')
		.whereNotNull('pm.body_hash')
		.groupBy('pm.body_hash')
		.having(knex.raw('count(*) >= ?', [minCount]))
		.having(knex.raw('count(distinct coalesce("pm"."title_text_id", -1)) = 1'))
		.orderBy([
			{ column: 'ogUrlMismatchRatio', order: 'desc' },
			{ column: 'cnt', order: 'desc' },
			{ column: 'pm.body_hash', order: 'asc' },
		])
		.limit(limit)
		.offset(offset)) as {
		bodyHash: Uint8Array;
		cnt: number;
		ogUrlMismatchRatio: number;
	}[];

	if (clusterRows.length === 0) {
		return [];
	}

	// Stage 2: every member URL for every surviving cluster, fetched in ONE
	// `whereIn` query rather than one query per cluster (the driver only
	// binds Buffer, not a plain Uint8Array, for a BLOB parameter — `row.bodyHash`
	// as returned by stage 1 is a bare Uint8Array, so each must be re-wrapped
	// before use in `.whereIn()`), then grouped back into per-cluster URL
	// lists in memory. `orderBy('ur.url', 'asc')` over the combined result set
	// still yields each cluster's own URLs in ascending order, since rows are
	// appended to their cluster's list in the order the single query returns
	// them.
	const bodyHashes = clusterRows.map((row) => Buffer.from(row.bodyHash));
	const urlRows = (await knex('page_meta as pm')
		.join('content_items as ci', 'ci.id', 'pm.page_id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ur.url as url', 'pm.body_hash as bodyHash')
		.where({ 'ci.scraped': 1, 'ci.is_external': 0 })
		.whereIn('pm.body_hash', bodyHashes)
		.whereNull('ci.redirect_dest_id')
		.whereNull('ci.alias_of_id')
		.orderBy('ur.url', 'asc')) as { url: string; bodyHash: Uint8Array }[];

	const urlsBySignature = new Map<string, string[]>();
	for (const row of urlRows) {
		const signature = Buffer.from(row.bodyHash).toString('hex');
		const urls = urlsBySignature.get(signature);
		if (urls) {
			urls.push(row.url);
		} else {
			urlsBySignature.set(signature, [row.url]);
		}
	}

	return clusterRows.map((row) => {
		const signature = Buffer.from(row.bodyHash).toString('hex');
		const urls = urlsBySignature.get(signature) ?? [];

		return {
			signature,
			count: Number(row.cnt),
			ogUrlMismatchRatio: Number(row.ogUrlMismatchRatio),
			samplePages: urls.slice(0, samplePagesLimit),
			commonDirectories: computeDirectoryDistribution(urls),
		};
	});
}
