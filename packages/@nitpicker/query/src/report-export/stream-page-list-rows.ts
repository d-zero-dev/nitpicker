import type { PageListStreamRow, StreamPageListRowsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { hasDedupeCapEventIdColumn } from '../has-dedupe-cap-event-id-column.js';
import { joinViewerPageIdsToListItems } from '../join-viewer-page-ids-to-list-items.js';
import { hasPageTemplatesTable } from '../page-templates-join.js';

import { applyPageListRowFilters } from './apply-page-list-row-filters.js';

/** `viewer_pages` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 2000;

/**
 * Streams every listable page for the Page List report sheet, in
 * `viewer_pages.natural_url_rank` order.
 *
 * Unlike `listViewerPages` (the viewer UI's paginated API this wraps),
 * this is a plain forward-only sweep: it never computes `total` or
 * `facets` (Page List doesn't use either — `facets` in particular is a
 * `viewer_count_buckets` read plus a `page_templates` `DISTINCT` that
 * `listViewerPages` recomputes on every call, wasted work when repeated
 * once per report cursor batch), and it resolves the `page_templates`/
 * `dedupe_cap_event_id` schema-presence checks {@link joinViewerPageIdsToListItems}
 * needs exactly once up front instead of once per batch.
 *
 * Which pages are listable is decided by {@link applyPageListRowFilters}:
 * internal HTML (or not-yet-classified) pages, narrowed by
 * `options.directories` when the caller wants one subtree instead of the
 * whole site. `countPageListRows` applies the same predicates, so a report
 * can size its output before streaming it.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current before calling this
 *   — it assumes `viewer_pages` exists and trusts its content.
 * @param options - Read size and directory-prefix filters. Defaults to the
 *   whole site read in {@link READ_CHUNK_SIZE}-row chunks.
 * @yields One chunk's rows, in `natural_url_rank` order.
 * @throws {RangeError} If `options.chunkSize` is not positive.
 * @throws {TypeError} If an `options.directories` entry is not a usable
 *   prefix (see `parsePageDirectoryPrefix`).
 * @example
 * for await (const chunk of streamPageListRows(accessor, { directories: ['/blog'] })) {
 *   for (const item of chunk) {
 *     sheet.appendRow(toPageListRow(item));
 *   }
 * }
 */
export async function* streamPageListRows(
	accessor: ArchiveAccessor,
	options: StreamPageListRowsOptions | number = {},
): AsyncGenerator<PageListStreamRow[]> {
	const resolvedOptions = typeof options === 'number' ? { chunkSize: options } : options;
	const chunkSize = resolvedOptions.chunkSize ?? READ_CHUNK_SIZE;
	if (chunkSize <= 0) {
		throw new RangeError(
			`streamPageListRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}
	const knex = accessor.getKnex();
	const schemaFlags = {
		hasPageTemplates: await hasPageTemplatesTable(knex),
		hasDedupeCapColumn: await hasDedupeCapEventIdColumn(knex),
	};

	let lastRank = -1;
	for (;;) {
		const idRows: { page_id: number; natural_url_rank: number }[] = await knex(
			'viewer_pages',
		)
			.modify((qb) => applyPageListRowFilters(qb, resolvedOptions))
			.where('natural_url_rank', '>', lastRank)
			.orderBy('natural_url_rank', 'asc')
			.limit(chunkSize)
			.select('page_id', 'natural_url_rank');

		if (idRows.length === 0) {
			return;
		}
		lastRank = idRows.at(-1)!.natural_url_rank;

		const pageIds = idRows.map((row) => row.page_id);
		const items = await joinViewerPageIdsToListItems(knex, pageIds, schemaFlags);
		if (items.length !== idRows.length) {
			// joinViewerPageIdsToListItems preserves pageIds' order but can drop
			// a page_id that raced out of viewer_pages between this read and its
			// own join (see its docs) — not expected for a report run, which
			// reads a single already-completed archive with no concurrent
			// writer. Surfacing this loudly beats silently pairing the wrong
			// pageId onto an item below.
			throw new Error(
				`streamPageListRows: expected ${idRows.length} joined rows, got ${items.length}`,
			);
		}

		yield items.map((item, i) => ({ ...item, pageId: pageIds[i]! }));
	}
}
