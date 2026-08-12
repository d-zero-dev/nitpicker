import type {
	CursorPaginatedDirectoryPageList,
	DirectoryPageListItem,
	ListDirectoryPagesOptions,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { decodeDirectoryPagesCursor } from './directory-pages-cursor/decode-directory-pages-cursor.js';
import { encodeDirectoryPagesCursor } from './directory-pages-cursor/encode-directory-pages-cursor.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/** Default page size — matches `listViewerPages`'s own default. */
const DEFAULT_LIMIT = 100;

/** One id-resolution row from `viewer_directory_pages`. */
interface DirectoryPageIdRow {
	/** `viewer_directory_pages.page_id`. */
	page_id: number;
	/** `viewer_directory_pages.page_url_sort_key`. */
	page_url_sort_key: string;
}

/** One display-join row from `viewer_pages`. */
interface ViewerPageDisplayRow {
	/** `viewer_pages.page_id`. */
	page_id: number;
	/** `viewer_pages.url`. */
	url: string;
	/** `viewer_pages.title`. */
	title: string | null;
	/** `viewer_pages.status`. */
	status: number | null;
	/** `viewer_pages.content_category`. */
	content_category: string;
}

/**
 * Joins an already ID-limited, already-ordered `page_id` window back to
 * `viewer_pages` for display fields — display columns are read only after
 * the id window is limit-bounded, the same limit-then-join pattern
 * `joinViewerPageIdsToListItems` follows for `/api/pages`.
 * @param accessor - The archive accessor to query.
 * @param pageIds - The page IDs to fetch, already filtered/sorted/limited by
 *   the `viewer_directory_pages` id-resolution stage.
 * @returns The corresponding {@link DirectoryPageListItem} rows, in `pageIds` order.
 */
async function joinDirectoryPageIdsToListItems(
	accessor: ArchiveAccessor,
	pageIds: number[],
): Promise<DirectoryPageListItem[]> {
	if (pageIds.length === 0) {
		return [];
	}
	const knex = accessor.getKnex();
	const rows: ViewerPageDisplayRow[] = await knex('viewer_pages')
		.whereIn('page_id', pageIds)
		.select('page_id', 'url', 'title', 'status', 'content_category');
	const rowsById = new Map(rows.map((row) => [row.page_id, row]));
	return pageIds
		.map((id) => rowsById.get(id))
		.filter((row): row is ViewerPageDisplayRow => row != null)
		.map((row) => ({
			pageId: row.page_id,
			url: row.url,
			title: row.title,
			status: row.status,
			contentCategory: row.content_category,
		}));
}

/**
 * Lists the pages attached directly to one directory node — NEVER its
 * descendants further down the tree (`/api/directory-tree/pages` returns
 * direct memberships only; subtree listing is not part of its contract, so
 * no recursive traversal happens at request time). Cursor-paginated
 * on `viewer_directory_pages`'s one fixed sort (`page_url_sort_key` ascending,
 * `page_id` tie-breaker) — forward-only, unlike `listViewerPages`'s
 * bidirectional keyset, since this endpoint has no virtual-scroll-upward
 * requirement.
 *
 * `status = 404` and out-of-scope (`isExternal`) pages never appear here:
 * both are dropped at read-model build time (see `buildDirectoryTreeRows`),
 * so they own no `viewer_directory_pages` membership row rather than being
 * filtered per request. Use the Pages view's `status` / `isExternal` filters
 * to locate them.
 * @param accessor - The archive accessor to query.
 * @param options - See {@link ListDirectoryPagesOptions}.
 * @returns Up to `limit` pages plus a `nextCursor` for continuation, or
 *   `null` once the last page has been reached. Returns an empty, terminated
 *   result when the read model has not been built or is stale (see
 *   `getDirectoryTree`'s docs on why `isViewerReadModelCurrent`, not just
 *   `hasViewerReadModel`, guards this).
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted for
 *   a different `nodeId`.
 * @example
 * // Virtual-scroll continuation — the caller only ever inspects nextCursor:
 * const page1 = await listDirectoryPages(accessor, { nodeId, limit: 100 });
 * const page2 = page1.nextCursor
 *   ? await listDirectoryPages(accessor, { nodeId, limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listDirectoryPages(
	accessor: ArchiveAccessor,
	options: ListDirectoryPagesOptions,
): Promise<CursorPaginatedDirectoryPageList> {
	if (!(await isViewerReadModelCurrent(accessor))) {
		return { items: [], nextCursor: null };
	}

	const { nodeId } = options;
	const limit = options.limit ?? DEFAULT_LIMIT;
	const knex = accessor.getKnex();

	const qb = knex('viewer_directory_pages').where('node_id', nodeId);
	if (options.cursor) {
		const decoded = decodeDirectoryPagesCursor(options.cursor, nodeId);
		qb.whereRaw('(page_url_sort_key, page_id) > (?, ?)', [
			decoded.pageUrlSortKey,
			decoded.pageId,
		]);
	}
	const fetched: DirectoryPageIdRow[] = await qb
		.select('page_id', 'page_url_sort_key')
		.orderBy(['page_url_sort_key', 'page_id'])
		.limit(limit + 1);

	const hasMoreAfter = fetched.length > limit;
	const window = fetched.slice(0, limit);
	const items = await joinDirectoryPageIdsToListItems(
		accessor,
		window.map((row) => row.page_id),
	);

	const lastRow = window.at(-1);
	const nextCursor =
		hasMoreAfter && lastRow
			? encodeDirectoryPagesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					nodeId,
					pageUrlSortKey: lastRow.page_url_sort_key,
					pageId: lastRow.page_id,
				})
			: null;

	return { items, nextCursor };
}
