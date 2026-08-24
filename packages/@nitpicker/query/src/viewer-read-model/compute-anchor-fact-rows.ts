import type { AnchorFactInsertRow } from './types.js';
import type { Knex } from 'knex';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/**
 * Span of `source.id` (`content_items.id`) values scanned per
 * `anchor_edges` chunk, by default. Unlike `computeResourceInsertRows`'s
 * `chunkSize` (a row count), this is an id-range width — see this
 * function's docs for why.
 */
const READ_CHUNK_SIZE = 2000;

/**
 * Computes one row per unique `(source_page_id, dest_page_id)` pair for
 * bulk insert into `viewer_anchor_facts`, for `viewer_external_links` to
 * derive its summary from afterward (`deriveExternalLinkSummaryRows`) —
 * this is the only `anchor_edges` scan the read-model build performs for
 * either table.
 *
 * Reads the 0.13 `anchor_edges` table (already deduped to distinct
 * `(page_id, href_page_id)` with a per-pair `count` column) rather than the
 * per-row legacy `anchors` table, and resolves URLs through `url_refs`
 * (`content_items.url_id`). Because `anchor_edges` is already grouped per
 * `(page_id, href_page_id)`, the output count is `SUM(ae.count)` across the
 * resolved-canonical destinations: multiple distinct dest pages that
 * redirect to the same canonical collapse into one output row and their
 * counts must add — the same summed occurrence count a `count(*)` over
 * per-row anchor rows yields. `first_text_id` is `MIN(ae.first_text_id)`
 * over the same group, so `listInboundLinks` can read anchor text straight
 * off `viewer_anchor_facts` without a second `anchor_edges` round-trip. When
 * the group is a single `anchor_edges` row (the common case — one referrer,
 * one href), this exactly mirrors that row's own first-wins anchor text.
 * When redirect/alias resolution collapses *distinct* `anchor_edges` rows
 * from the same referrer into one group (e.g. one anchor points directly at
 * the canonical destination and another points at a redirect source that
 * lands on it), `MIN()` picks the lower `text_refs.id` — a deterministic,
 * stable choice across rebuilds, but not a guarantee that it's the
 * chronologically-first-observed anchor among the distinct hrefs (unlike the
 * single-row case, `text_refs.id` order need not track anchor-array order
 * once ids are shared/reused elsewhere in the archive).
 *
 * Reads `anchor_edges` in bounded chunks by partitioning `source.id`
 * (`content_items.id`) into non-overlapping ranges
 * (`WHERE source.id > :start AND source.id <= :end`) and running the
 * unmodified `GROUP BY`/aggregation once per range — NOT by paginating the
 * aggregated output with `LIMIT`. The `GROUP BY` key here is the compound
 * `(source.id, resolved dest id)`; a single `source.id` can legitimately
 * produce several output rows (one page can link to many distinct
 * destinations), and a `LIMIT` on the aggregated output could stop mid-way
 * through one `source.id`'s groups and silently skip the rest. Filtering
 * on `source.id` itself is all-or-nothing per source page, so a group can
 * never straddle two ranges. An empty range is not a stop condition (a
 * `source.id` range with zero anchor_edges is unremarkable); the loop
 * instead runs until `rangeStart` passes `content_items`'s max id.
 *
 * Redirect resolution (`COALESCE(canonical_alias.*, canonical.*,
 * alias_canonical.*, dest.*)`, resolving through both `redirect_dest_id` and
 * `alias_of_id` — a page is never both a redirect source and a
 * URL-normalization alias of another page, but resolving both keeps this
 * correct either way without needing to know which) and the broken-link
 * definition (`status = 404` strictly — see `list-links.ts`'s scope note)
 * are preserved verbatim. `canonical_alias` is one further `alias_of_id` hop
 * past `canonical`, since a redirect *destination* row can itself be a
 * non-representative alias member of a different group (`backfillAliasOfId`
 * only excludes redirect *sources* from alias candidacy).
 * @param trx - An open Knex transaction (a plain `Knex` instance also
 *   works, e.g. in tests).
 * @param chunkSize - Width of the `source.id` range scanned per chunk. Must
 *   be positive.
 * @param onProgress - Called once per range scanned (including empty ones),
 *   with the id scanned up to so far and the max `content_items.id`
 *   (issue #294: on a large archive this whole generator can run for
 *   minutes with no other signal it hasn't hung). Omit for no reporting
 *   (the default; e.g. tests).
 * @yields {AnchorFactInsertRow[]} One `source.id` range's rows, one per
 *   unique `(source_page_id, dest_page_id)` pair in that range.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of computeAnchorFactRows(trx)) {
 *   await trx('viewer_anchor_facts').insert(chunk);
 * }
 */
export async function* computeAnchorFactRows(
	trx: Knex,
	chunkSize = READ_CHUNK_SIZE,
	onProgress?: (scannedUpToId: number, maxId: number) => void,
): AsyncGenerator<AnchorFactInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeAnchorFactRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	// `canonical_alias` resolves one further `alias_of_id` hop past
	// `canonical`: a redirect destination row can itself be a
	// non-representative alias member of a *different* group
	// (`backfillAliasOfId`'s candidate selection excludes redirect *sources*
	// from alias grouping, not redirect *destinations*), so `canonical`
	// alone is not always the final representative.
	const destIdExpression =
		'COALESCE("canonical_alias"."id", "canonical"."id", "alias_canonical"."id", "dest"."id")';
	const statusExpression =
		'COALESCE("canonical_alias"."status", "canonical"."status", "alias_canonical"."status", "dest"."status")';
	const isExternalExpression =
		'COALESCE("canonical_alias"."is_external", "canonical"."is_external", "alias_canonical"."is_external", "dest"."is_external")';
	const destUrlExpression =
		'COALESCE("canonical_alias_url"."url", "canonical_url"."url", "alias_canonical_url"."url", "dest_url"."url")';

	const maxIdRows = (await trx('content_items').max('id as maxId')) as {
		maxId: number | null;
	}[];
	const maxId = maxIdRows[0]?.maxId ?? 0;

	for (let rangeStart = 0; rangeStart < maxId; rangeStart += chunkSize) {
		const rangeEnd = rangeStart + chunkSize;

		const rows: {
			sourcePageId: number;
			destPageId: number;
			sourceUrlRefId: number | null;
			destUrlRefId: number | null;
			rawDestUrlRefId: number | null;
			status: number | null;
			isExternal: 0 | 1;
			count: number;
			firstTextId: number | null;
		}[] = await trx('anchor_edges as ae')
			.join('content_items as source', 'ae.page_id', '=', 'source.id')
			.join('content_items as dest', 'ae.href_page_id', '=', 'dest.id')
			.leftJoin(
				'content_items as canonical',
				'dest.redirect_dest_id',
				'=',
				'canonical.id',
			)
			.leftJoin(
				'content_items as alias_canonical',
				'dest.alias_of_id',
				'=',
				'alias_canonical.id',
			)
			.leftJoin(
				'content_items as canonical_alias',
				'canonical.alias_of_id',
				'=',
				'canonical_alias.id',
			)
			.join('url_refs as source_url', 'source.url_id', '=', 'source_url.id')
			.join('url_refs as dest_url', 'dest.url_id', '=', 'dest_url.id')
			.leftJoin('url_refs as canonical_url', 'canonical.url_id', '=', 'canonical_url.id')
			.leftJoin(
				'url_refs as alias_canonical_url',
				'alias_canonical.url_id',
				'=',
				'alias_canonical_url.id',
			)
			.leftJoin(
				'url_refs as canonical_alias_url',
				'canonical_alias.url_id',
				'=',
				'canonical_alias_url.id',
			)
			.leftJoin('viewer_url_refs as source_ref', 'source_url.url', '=', 'source_ref.url')
			.leftJoin('viewer_url_refs as dest_ref', function () {
				this.on(trx.raw(`"dest_ref"."url" = ${destUrlExpression}`));
			})
			// Raw (pre-redirect/alias) href target, keyed on `dest_url` — the
			// immediate `anchor_edges.href_page_id` URL joined above — as
			// opposed to `dest_ref`, which is keyed on the resolved-canonical
			// `destUrlExpression`. See `raw_dest_url_ref_id`'s DDL comment for
			// why outbound-link auditing wants this unresolved value.
			.leftJoin(
				'viewer_url_refs as raw_dest_ref',
				'dest_url.url',
				'=',
				'raw_dest_ref.url',
			)
			.where('source.id', '>', rangeStart)
			.andWhere('source.id', '<=', rangeEnd)
			.groupBy('source.id', trx.raw(destIdExpression))
			.select(
				'source.id as sourcePageId',
				trx.raw(`${destIdExpression} as "destPageId"`),
				'source_ref.id as sourceUrlRefId',
				'dest_ref.id as destUrlRefId',
				// MIN(), not a bare column: a group can span multiple distinct
				// `anchor_edges` rows collapsed onto the same resolved dest
				// (see the class docs' `first_text_id` discussion), each with
				// its own raw href target — same determinism rationale as
				// `first_text_id`'s `MIN()` below.
				trx.raw('min("raw_dest_ref"."id") as "rawDestUrlRefId"'),
				trx.raw(`${statusExpression} as "status"`),
				trx.raw(`${isExternalExpression} as "isExternal"`),
				trx.raw('sum("ae"."count") as "count"'),
				trx.raw('min("ae"."first_text_id") as "firstTextId"'),
			);

		if (rows.length === 0) {
			onProgress?.(Math.min(rangeEnd, maxId), maxId);
			continue;
		}

		yield rows.map((row) => {
			const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
			if (
				row.sourceUrlRefId == null ||
				row.destUrlRefId == null ||
				row.rawDestUrlRefId == null
			) {
				throw new Error(
					`computeAnchorFactRows: missing viewer_url_refs entry for source=${row.sourcePageId}, dest=${row.destPageId}`,
				);
			}
			return {
				source_page_id: row.sourcePageId,
				dest_page_id: row.destPageId,
				source_url_ref_id: row.sourceUrlRefId,
				dest_url_ref_id: row.destUrlRefId,
				raw_dest_url_ref_id: row.rawDestUrlRefId,
				status: row.status,
				status_sort_key: statusSortKey,
				status_desc_key: -statusSortKey,
				count: Number(row.count),
				is_broken: row.status === 404 ? 1 : 0,
				is_external_link: row.isExternal ? 1 : 0,
				first_text_id: row.firstTextId,
			};
		});
		onProgress?.(Math.min(rangeEnd, maxId), maxId);
	}
}
