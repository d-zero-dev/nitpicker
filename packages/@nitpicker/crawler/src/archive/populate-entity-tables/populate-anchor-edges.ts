import type { AnchorEdgeRowInProgress, AnchorInputRow } from './types.js';
import type { Knex } from 'knex';

import { collapseAnchorRows } from './collapse-anchor-rows.js';
import { resolveTextRefs } from './resolve-text-refs.js';

/**
 * Rows scanned per keyset-paginated `SELECT` chunk against `anchors`.
 * `anchors` is the largest table in the archive (≈ 13 M rows on the
 * reference archive) so the chunk size trades off memory against
 * round-trip overhead. 5 000 rows per SELECT keeps peak chunk memory
 * ≈ 5 MB (per-row ≈ 1 KB with URL / textContent stored elsewhere) and
 * amortises the per-query round-trip cost across many collapses.
 */
const READ_CHUNK_SIZE = 5000;

/**
 * Edges buffered before a bulk `INSERT INTO anchor_edges ... VALUES
 * (...)`. Each edge binds 5 params so 1 000 rows = 5 000 params — well
 * inside the SQLite variable limit. Emitting on this cadence bounds
 * peak buffered-edge memory to ≈ 100 KB.
 */
const INSERT_CHUNK_SIZE = 1000;

/**
 * Populates `anchor_edges` from `anchors` (issue #193 step entity populate step 4).
 *
 * The algorithm is a **single keyset-paginated scan** over `anchors`
 * ordered by `(pageId, hrefId, id)`. Each chunk feeds
 * {@link ./collapse-anchor-rows.ts}, which yields one edge per distinct
 * `(pageId, hrefId)` pair as soon as the pair boundary is observed.
 *
 * A boundary can straddle two chunks (the last row of chunk N shares a
 * pair with the first row of chunk N+1), so the outer loop keeps an
 * "open edge" state that flushes only when the *next* pair actually
 * starts. On end-of-stream the last open edge is emitted.
 *
 * `first_text_id` is left unresolved during the streaming pass — the
 * text is buffered on each pending edge and resolved in bulk by
 * {@link ./resolve-text-refs.ts} at INSERT time. Every INSERT batch
 * therefore issues one text-refs lookup + one INSERT, keeping DB
 * round-trips per edge low.
 *
 * `INSERT OR IGNORE` on the `(page_id, href_page_id)` UNIQUE composite
 * makes the step idempotent: a re-run after partial failure re-emits the
 * same edges but the writes no-op.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateAnchorEdges(trx);
 * });
 */
export async function populateAnchorEdges(trx: Knex): Promise<void> {
	let cursorPageId = 0;
	let cursorHrefId = 0;
	let cursorId = 0;
	let carryOver: AnchorEdgeRowInProgress | null = null;
	const pending: AnchorEdgeRowInProgress[] = [];

	while (true) {
		const rows: AnchorInputRow[] = await trx('anchors')
			.select('id', 'pageId', 'hrefId', 'hash', 'textContent')
			.where(function () {
				this.where('pageId', '>', cursorPageId)
					.orWhere(function () {
						this.where('pageId', cursorPageId).andWhere('hrefId', '>', cursorHrefId);
					})
					.orWhere(function () {
						this.where('pageId', cursorPageId)
							.andWhere('hrefId', cursorHrefId)
							.andWhere('id', '>', cursorId);
					});
			})
			.orderBy([
				{ column: 'pageId', order: 'asc' },
				{ column: 'hrefId', order: 'asc' },
				{ column: 'id', order: 'asc' },
			])
			.limit(READ_CHUNK_SIZE);
		if (rows.length === 0) {
			break;
		}
		const lastRow = rows.at(-1)!;
		cursorPageId = lastRow.pageId;
		cursorHrefId = lastRow.hrefId;
		cursorId = lastRow.id;

		const chunkEdges = [...collapseAnchorRows(rows)];
		for (const edge of chunkEdges) {
			if (
				carryOver !== null &&
				carryOver.page_id === edge.page_id &&
				carryOver.href_page_id === edge.href_page_id
			) {
				carryOver.count += edge.count;
				continue;
			}
			if (carryOver !== null) {
				pending.push(carryOver);
			}
			carryOver = edge;
			if (pending.length >= INSERT_CHUNK_SIZE) {
				await flush(trx, pending);
			}
		}
	}
	if (carryOver !== null) {
		pending.push(carryOver);
	}
	if (pending.length > 0) {
		await flush(trx, pending);
	}
}

/**
 * Resolves `first_text_id` for every buffered edge in `pending`, then
 * bulk-inserts the batch into `anchor_edges` and clears the buffer.
 *
 * Extracted from the main loop so the "resolve + insert" pair happens in
 * exactly one place — the streaming loop, the carry-over flush at
 * end-of-stream, and any future re-order boundary all land here.
 * @param trx - Knex instance or transaction.
 * @param pending - Buffered edges awaiting `first_text_id` resolution
 *   and INSERT; mutated in place (cleared on return).
 */
async function flush(trx: Knex, pending: AnchorEdgeRowInProgress[]): Promise<void> {
	const texts = new Set<string>();
	for (const edge of pending) {
		if (edge.first_textContent != null && edge.first_textContent !== '') {
			texts.add(edge.first_textContent);
		}
	}
	const textIds = await resolveTextRefs(trx, texts);
	const inserts = pending.map((edge) => ({
		page_id: edge.page_id,
		href_page_id: edge.href_page_id,
		count: edge.count,
		first_hash: edge.first_hash,
		first_text_id:
			edge.first_textContent != null && edge.first_textContent !== ''
				? (textIds.get(edge.first_textContent) ?? null)
				: null,
	}));
	await trx('anchor_edges')
		.insert(inserts)
		.onConflict(['page_id', 'href_page_id'])
		.ignore();
	pending.length = 0;
}
