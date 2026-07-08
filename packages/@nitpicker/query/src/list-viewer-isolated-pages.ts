import type { IsolatedPageEntry, ListIsolatedPagesOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

/**
 *
 * @param query
 * @param sortBy
 * @param sortOrder
 */
function applyIsolatedPageOrder(
	query: Knex.QueryBuilder,
	sortBy: ListIsolatedPagesOptions['sortBy'],
	sortOrder: ListIsolatedPagesOptions['sortOrder'],
): Knex.QueryBuilder {
	switch (sortBy ?? 'url') {
		case 'title': {
			query.orderBy('pages.title_sort_key', sortOrder === 'desc' ? 'desc' : 'asc');
			break;
		}
		case 'status': {
			query.orderBy(
				sortOrder === 'desc' ? 'pages.status_desc_key' : 'pages.status_sort_key',
				'asc',
			);
			break;
		}
		case 'source': {
			query.orderBy('pages.source', sortOrder === 'desc' ? 'desc' : 'asc');
			break;
		}
		default: {
			query.orderBy('pages.url_sort_key', sortOrder === 'desc' ? 'desc' : 'asc');
			break;
		}
	}
	return query.orderBy('pages.page_id', 'asc');
}

/**
 * Fast-path counterpart of `listIsolatedPages`, backed by
 * `viewer_isolated_components` + `viewer_isolated_component_pages`.
 *
 * Unlike the legacy implementation's in-memory `sortArrayItems(..., type:
 * 'url')`, URL ordering here is plain SQLite `BINARY` on the precomputed
 * `url_sort_key`, matching the established `viewer_pages` fast-path
 * convention.
 * @param accessor - Archive accessor whose read model is current.
 * @param options - Filters and offset pagination.
 * @returns Singleton isolated pages with the same public shape as `listIsolatedPages`.
 */
export async function listViewerIsolatedPages(
	accessor: ArchiveAccessor,
	options: ListIsolatedPagesOptions = {},
): Promise<{ items: IsolatedPageEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseQuery = knex('viewer_isolated_components as components')
		.join(
			'viewer_isolated_component_pages as pages',
			'components.component_id',
			'=',
			'pages.component_id',
		)
		.where('components.size', 1);

	if (options.urlPattern) {
		baseQuery.where('pages.url', 'like', options.urlPattern);
	}
	if (options.status != null) {
		baseQuery.where('pages.status', options.status);
	}
	if (options.source) {
		baseQuery.where('pages.source', options.source);
	}

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.count('pages.page_id as total')) as { total: number }[];
	const total = Number(countResult[0]?.total ?? 0);

	const rows = (await applyIsolatedPageOrder(
		baseQuery.clone().select('pages.url', 'pages.title', 'pages.status', 'pages.source'),
		options.sortBy,
		options.sortOrder,
	)
		.limit(limit)
		.offset(offset)) as IsolatedPageEntry[];

	return { items: rows, total };
}
