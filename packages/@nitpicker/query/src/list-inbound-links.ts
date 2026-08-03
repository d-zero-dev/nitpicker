import type {
	InboundLinkEntry,
	InboundLinkList,
	ListInboundLinksOptions,
} from './types.js';
import type {
	InboundLinksKeysetRow,
	InboundLinksSortSpec,
} from './viewer-inbound-links-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';
import { requireViewerReadModel } from './require-viewer-read-model.js';
import { resolveAliasAndRedirectChain } from './resolve-alias-and-redirect-chain.js';
import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { buildInboundLinksFilterKey } from './viewer-inbound-links-cursor/build-inbound-links-filter-key.js';
import { decodeInboundLinksCursor } from './viewer-inbound-links-cursor/decode-inbound-links-cursor.js';
import { encodeInboundLinksCursor } from './viewer-inbound-links-cursor/encode-inbound-links-cursor.js';
import { extractInboundLinksSortValues } from './viewer-inbound-links-cursor/extract-inbound-links-sort-values.js';
import { getInboundLinksSortSpec } from './viewer-inbound-links-cursor/get-inbound-links-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Constrains a `viewer_anchor_facts` query builder to one destination page's
 * inbound edges — the only filter `listInboundLinks` supports. `dest_page_id`
 * is index-covered by `vaf_dest(dest_page_id, edge_id)`, so both the count
 * and the keyset window resolve in one index walk regardless of how many
 * millions of rows the table holds overall.
 * @param qb - The query builder to constrain.
 * @param destPageId - The resolved canonical `content_items.id` to filter by.
 */
function applyInboundLinksFilters(qb: Knex.QueryBuilder, destPageId: number): void {
	qb.where('dest_page_id', destPageId);
}

/**
 * Counts the total inbound edges for one destination page.
 * @param knex - The archive's Knex instance.
 * @param destPageId - The resolved canonical `content_items.id` to count.
 * @returns The total referrer count.
 */
async function countInboundLinksTotal(knex: Knex, destPageId: number): Promise<number> {
	const qb = knex('viewer_anchor_facts');
	applyInboundLinksFilters(qb, destPageId);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}

/**
 * Runs one `viewer_anchor_facts` read via the shared {@link readKeysetWindow},
 * selecting the columns needed to resolve a referrer's URL and anchor text
 * afterward. No join runs here: URL strings and anchor text are resolved
 * from `viewer_url_refs`/`text_refs` only after the window is limit-bounded,
 * the same deferred-resolution shape `listViewerBrokenLinks` uses.
 * @param knex - The archive's Knex instance.
 * @param destPageId - The resolved canonical `content_items.id` to filter by.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows.
 */
async function readInboundLinksWindow(
	knex: Knex,
	destPageId: number,
	spec: InboundLinksSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<
	(InboundLinksKeysetRow & {
		source_url_ref_id: number;
		first_text_id: number | null;
		count: number;
	})[]
> {
	return readKeysetWindow(
		knex,
		'viewer_anchor_facts',
		(qb) => applyInboundLinksFilters(qb, destPageId),
		['source_url_ref_id', 'first_text_id', 'count'],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Loads URL strings for the limited inbound-link window.
 * @param knex - Query connection for the opened archive.
 * @param refIds - `viewer_url_refs` ids selected by the keyset window.
 * @returns A map from `viewer_url_refs.id` to URL.
 */
async function readUrlRefs(
	knex: Knex,
	refIds: readonly number[],
): Promise<Map<number, string>> {
	if (refIds.length === 0) {
		return new Map();
	}
	const rows: { id: number; url: string }[] = await knex('viewer_url_refs')
		.whereIn('id', [...new Set(refIds)])
		.select('id', 'url');
	return new Map(rows.map((row) => [row.id, row.url]));
}

/**
 * Loads anchor text for the limited inbound-link window.
 * @param knex - Query connection for the opened archive.
 * @param textIds - `text_refs` ids selected by the keyset window, `null`
 *   entries (anchors with no text) filtered out before the query.
 * @returns A map from `text_refs.id` to anchor text.
 */
async function readTextRefs(
	knex: Knex,
	textIds: readonly (number | null)[],
): Promise<Map<number, string>> {
	const ids = [...new Set(textIds.filter((id): id is number => id != null))];
	if (ids.length === 0) {
		return new Map();
	}
	const rows: { id: number; text: string }[] = await knex('text_refs')
		.whereIn('id', ids)
		.select('id', 'text');
	return new Map(rows.map((row) => [row.id, row.text]));
}

/**
 * Lists which pages link to a target page — the read-model-backed,
 * cursor-paginated counterpart to `getPageDetail.outboundLinks`'s reverse
 * direction, split out of `getPageDetail` itself because a page's referrer
 * count can reach the hundreds of thousands on a large site (issue #235).
 *
 * Reads exclusively from `viewer_anchor_facts` (see `requireViewerReadModel`)
 * — there is no live fallback, unlike most `viewer_*`-backed queries:
 * answering "who links here" without the `dest_page_id` index would require
 * a full `anchor_edges` scan resolved through
 * `COALESCE(redirect_dest_id, alias_of_id, id)` for every row, the exact
 * cost this function exists to avoid. Callers that must keep working during
 * a live crawl (stub mode, where the read model cannot exist) must check
 * `context.mode` and skip this query entirely rather than calling it.
 *
 * The initial read (no `cursor`), the forward keyset read, the backward
 * keyset read, and the direct-`offset` read are four separate code paths,
 * mirroring `listViewerBrokenLinks`/`listViewerDuplicateGroupPages`.
 * @param accessor - The archive accessor to query.
 * @param options - The target page's URL, plus pagination options.
 * @returns A cursor-paginated list of inbound-link entries, or `null` if
 *   `options.url` does not match any page in the archive.
 * @throws {Error} If `content_items.alias_of_id` does not exist on this
 *   connection (see `requireAliasOfIdColumn`), or if the viewer read model
 *   is missing or stale (see `requireViewerReadModel`).
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different filter/sort combination.
 * @example
 * // Page Detail's referrer count — skip the row window entirely:
 * const counted = await listInboundLinks(accessor, { url, limit: 0 });
 * console.log(counted?.total);
 * @example
 * // Virtual-scroll continuation — the caller only ever inspects nextCursor:
 * const page1 = await listInboundLinks(accessor, { url, limit: 100 });
 * const page2 = page1?.nextCursor
 *   ? await listInboundLinks(accessor, { url, limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listInboundLinks(
	accessor: ArchiveAccessor,
	options: ListInboundLinksOptions,
): Promise<InboundLinkList | null> {
	const knex = accessor.getKnex();
	await requireAliasOfIdColumn(knex);
	await requireViewerReadModel(accessor);

	const candidate = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ci.id as id')
		.where('ur.url', options.url)
		.first();
	if (!candidate) {
		return null;
	}
	const destPageId = await resolveAliasAndRedirectChain(knex, candidate.id);

	const limit = options.limit ?? 100;
	const spec = getInboundLinksSortSpec();
	const filterKey = buildInboundLinksFilterKey({ destPageId });

	const total = await countInboundLinksTotal(knex, destPageId);

	if (limit === 0) {
		return {
			url: options.url,
			items: [],
			total,
			limit: 0,
			offset: options.offset ?? 0,
			nextCursor: null,
			prevCursor: null,
		};
	}

	/**
	 * Builds the final result from a `limit`-or-fewer window, already in
	 * final display order.
	 * @param window - The trimmed row window.
	 * @param hasMoreAfter - Whether a subsequent page exists.
	 * @param hasMoreBefore - Whether a preceding page exists.
	 * @returns The full paginated result.
	 */
	async function buildResult(
		window: Awaited<ReturnType<typeof readInboundLinksWindow>>,
		hasMoreAfter: boolean,
		hasMoreBefore: boolean,
	): Promise<InboundLinkList> {
		const [urlByRefId, textByRefId] = await Promise.all([
			readUrlRefs(
				knex,
				window.map((row) => row.source_url_ref_id),
			),
			readTextRefs(
				knex,
				window.map((row) => row.first_text_id),
			),
		]);
		const items: InboundLinkEntry[] = window.map((row) => {
			const url = urlByRefId.get(row.source_url_ref_id);
			if (url == null) {
				throw new Error(
					`listInboundLinks: missing viewer_url_refs row ${row.source_url_ref_id}`,
				);
			}
			return {
				url,
				textContent:
					row.first_text_id == null ? null : (textByRefId.get(row.first_text_id) ?? null),
				count: row.count,
			};
		});
		const lastRow = window.at(-1);
		const firstRow = window[0];
		const nextCursor =
			hasMoreAfter && lastRow
				? encodeInboundLinksCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'edgeId',
						sortOrder: 'asc',
						values: extractInboundLinksSortValues(spec, lastRow),
					})
				: null;
		const prevCursor =
			hasMoreBefore && firstRow
				? encodeInboundLinksCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'edgeId',
						sortOrder: 'asc',
						values: extractInboundLinksSortValues(spec, firstRow),
					})
				: null;
		return {
			url: options.url,
			items,
			total,
			limit,
			offset: options.offset ?? 0,
			nextCursor,
			prevCursor,
		};
	}

	if (options.cursor) {
		const decoded = decodeInboundLinksCursor(options.cursor, { filterKey });
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readInboundLinksWindow(
				knex,
				destPageId,
				spec,
				oppositeDirection,
				limit,
				{ operator: spec.scanDirection === 'asc' ? '<' : '>', values: decoded.values },
				0,
			);
			const hasMoreBefore = fetched.length > limit;
			const window = fetched.slice(0, limit).toReversed();
			return await buildResult(window, true, hasMoreBefore);
		}
		const fetched = await readInboundLinksWindow(
			knex,
			destPageId,
			spec,
			spec.scanDirection,
			limit,
			{ operator: spec.scanDirection === 'asc' ? '>' : '<', values: decoded.values },
			0,
		);
		const hasMoreAfter = fetched.length > limit;
		const window = fetched.slice(0, limit);
		return await buildResult(window, hasMoreAfter, true);
	}

	const offset = options.offset ?? 0;
	const fetched = await readInboundLinksWindow(
		knex,
		destPageId,
		spec,
		spec.scanDirection,
		limit,
		undefined,
		offset,
	);
	const hasMoreAfter = fetched.length > limit;
	const window = fetched.slice(0, limit);
	return await buildResult(window, hasMoreAfter, offset > 0);
}
