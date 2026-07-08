import type { GraphEdgeInsertRow } from './types.js';
import type { Knex } from 'knex';

/** Rows read per `viewer_anchor_facts` chunk while deriving graph edges. */
const READ_CHUNK_SIZE = 2000;

/**
 * Streams the subset of `viewer_anchor_facts` that forms the internal HTML
 * graph used by `/api/graph`.
 *
 * The source of truth is the already-built `viewer_anchor_facts` table, not a
 * second live `anchors` JOIN: redirects are already canonical-resolved there,
 * duplicate anchor observations are already deduplicated one-per-pair there,
 * and scanning it in chunks avoids materialising millions of edges at once.
 * `viewer_pages` joins apply the same internal-HTML predicate `getLinkGraph`
 * used on the write model (`is_external = 0`, `content_category = 'html'`)
 * while excluding self-links.
 * @param trx - Open transaction / connection.
 * @param chunkSize - Rows per chunk, overridable for tests.
 */
export async function* computeGraphReadModelRows(
	trx: Knex,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<GraphEdgeInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeGraphReadModelRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	let lastEdgeId = 0;
	for (;;) {
		const rows = (await trx('viewer_anchor_facts as facts')
			.join('viewer_pages as source', 'facts.source_page_id', '=', 'source.page_id')
			.join('viewer_pages as dest', 'facts.dest_page_id', '=', 'dest.page_id')
			.where({
				'source.is_external': 0,
				'source.content_category': 'html',
				'dest.is_external': 0,
				'dest.content_category': 'html',
			})
			.whereRaw('"facts"."source_page_id" != "facts"."dest_page_id"')
			.where('facts.edge_id', '>', lastEdgeId)
			.orderBy('facts.edge_id', 'asc')
			.limit(chunkSize)
			.select(
				'facts.edge_id as edgeId',
				'facts.source_page_id as sourcePageId',
				'facts.dest_page_id as targetPageId',
			)) as { edgeId: number; sourcePageId: number; targetPageId: number }[];

		if (rows.length === 0) {
			return;
		}

		lastEdgeId = rows.at(-1)?.edgeId ?? lastEdgeId;
		yield rows.map((row) => ({
			source_page_id: row.sourcePageId,
			target_page_id: row.targetPageId,
		}));
	}
}
