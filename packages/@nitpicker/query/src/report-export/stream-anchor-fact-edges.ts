import type { ArchiveAccessor } from '@nitpicker/crawler';

/** `viewer_anchor_facts` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 2000;

/** One `viewer_anchor_facts` edge, resolved for the Referrers Relational Table report sheet. */
export interface AnchorFactEdgeStreamRow {
	/** The resolved (redirect/alias-followed) destination page's URL. */
	destUrl: string;
	/** The referring page's URL. */
	sourceUrl: string;
	/**
	 * The immediate, pre-resolution href target. Equal to {@link destUrl}
	 * unless the referrer linked to a redirect source or alias member —
	 * callers wanting the legacy report's `[REDIRECTED FROM]` note can
	 * compare the two.
	 */
	rawDestUrl: string;
	/** First-wins anchor text for this (source, dest) pair, or `null`. */
	textContent: string | null;
	/** The destination page's HTTP status, or `null` if unknown. */
	status: number | null;
	/** The destination page's HTTP status text, or `null` if unknown. */
	statusText: string | null;
	/** The destination page's raw `Content-Type` header value, or `null`. */
	contentType: string | null;
	/**
	 * Occurrence count collapsed into this edge (see
	 * `AnchorFactInsertRow.count`'s docs) — new in the report rewrite,
	 * replacing the legacy report's one-row-per-raw-anchor grain (this is
	 * one row per unique resolved (source, dest) pair instead).
	 */
	count: number;
}

/**
 * Streams every `viewer_anchor_facts` edge for the Referrers Relational
 * Table report sheet.
 *
 * `edge_id` is a real `INTEGER PRIMARY KEY` (not `WITHOUT ROWID`), and this
 * is a 1:1 projection (one output row per edge row), so plain `edge_id`
 * keyset pagination is safe — no compound-group chunking hazard like
 * `computeAnchorFactRows`' `source.id`-range scan (that function groups
 * multiple `anchor_edges` rows per output row; this one does not group at
 * all).
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — see
 *   `getOutboundLinkFactsByPageIds`'s docs for why the check happens once
 *   per report run, not once per batch.
 * @param chunkSize - `viewer_anchor_facts` rows read per chunk. Must be
 *   positive.
 * @yields One chunk's rows, in `edge_id` order.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of streamAnchorFactEdges(accessor)) {
 *   for (const row of chunk) {
 *     sheet.appendRow(toReferrersRelationalRow(row));
 *   }
 * }
 */
export async function* streamAnchorFactEdges(
	accessor: ArchiveAccessor,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<AnchorFactEdgeStreamRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`streamAnchorFactEdges: chunkSize must be positive, got ${chunkSize}`,
		);
	}
	const knex = accessor.getKnex();

	let lastId = 0;
	for (;;) {
		const rows: {
			edgeId: number;
			destUrl: string;
			sourceUrl: string;
			rawDestUrl: string;
			textContent: string | null;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			count: number;
		}[] = await knex('viewer_anchor_facts as vaf')
			.join('viewer_url_refs as dest_ref', 'dest_ref.id', 'vaf.dest_url_ref_id')
			.join('viewer_url_refs as source_ref', 'source_ref.id', 'vaf.source_url_ref_id')
			.join(
				'viewer_url_refs as raw_dest_ref',
				'raw_dest_ref.id',
				'vaf.raw_dest_url_ref_id',
			)
			.leftJoin('text_refs as text_ref', 'text_ref.id', 'vaf.first_text_id')
			.leftJoin('content_items as dest_ci', 'dest_ci.id', 'vaf.dest_page_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'dest_ci.content_type_id')
			.where('vaf.edge_id', '>', lastId)
			.orderBy('vaf.edge_id', 'asc')
			.limit(chunkSize)
			.select(
				'vaf.edge_id as edgeId',
				'dest_ref.url as destUrl',
				'source_ref.url as sourceUrl',
				'raw_dest_ref.url as rawDestUrl',
				'text_ref.text as textContent',
				'vaf.status as status',
				'dest_ci.status_text as statusText',
				'ctr.raw as contentType',
				'vaf.count as count',
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.edgeId;

		yield rows.map((row) => ({
			destUrl: row.destUrl,
			sourceUrl: row.sourceUrl,
			rawDestUrl: row.rawDestUrl,
			textContent: row.textContent,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			count: row.count,
		}));
	}
}
