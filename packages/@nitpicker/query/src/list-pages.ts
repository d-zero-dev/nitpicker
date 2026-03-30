import type { ListPagesOptions, PageListItem, PaginatedPageList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { paginateQuery } from './paginate-query.js';

/**
 * Lists pages from the archive with filtering, sorting, and pagination.
 * Applies filters at the SQL level for performance with large datasets.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns A paginated list of page entries with metadata.
 */
export async function listPages(
	accessor: ArchiveAccessor,
	options: ListPagesOptions = {},
): Promise<PaginatedPageList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseQuery = knex('pages').where('scraped', 1).whereNull('redirectDestId');

	if (options.status != null) {
		baseQuery.where('status', options.status);
	}
	if (options.statusMin != null) {
		baseQuery.where('status', '>=', options.statusMin);
	}
	if (options.statusMax != null) {
		baseQuery.where('status', '<=', options.statusMax);
	}
	if (options.isExternal != null) {
		baseQuery.where('isExternal', options.isExternal ? 1 : 0);
	}
	if (options.missingTitle) {
		baseQuery.where((qb) => {
			qb.whereNull('title').orWhere('title', '');
		});
	}
	if (options.missingDescription) {
		baseQuery.where((qb) => {
			qb.whereNull('description').orWhere('description', '');
		});
	}
	if (options.noindex) {
		baseQuery.where('noindex', 1);
	}
	if (options.urlPattern) {
		baseQuery.where('url', 'like', options.urlPattern);
	}
	if (options.directory) {
		const dir = options.directory.endsWith('/')
			? options.directory
			: `${options.directory}/`;
		baseQuery.where('url', 'like', `%${dir}%`);
	}

	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';

	return paginateQuery<
		{
			url: string;
			title: string | null;
			status: number | null;
			contentType: string | null;
			isExternal: 0 | 1;
			description: string | null;
			og_title: string | null;
			noindex: number | null;
		},
		PageListItem
	>({
		baseQuery,
		countColumn: 'id',
		applySelect: (q) =>
			q
				.select(
					'url',
					'title',
					'status',
					'contentType',
					'isExternal',
					'description',
					'og_title',
					'noindex',
				)
				.orderBy(sortBy, sortOrder),
		limit,
		offset,
		mapRow: (row) => ({
			url: row.url,
			title: row.title,
			status: row.status,
			contentType: row.contentType,
			isExternal: !!row.isExternal,
			hasDescription: row.description != null && row.description !== '',
			hasOgTitle: row.og_title != null && row.og_title !== '',
			noindex: !!row.noindex,
		}),
	});
}
