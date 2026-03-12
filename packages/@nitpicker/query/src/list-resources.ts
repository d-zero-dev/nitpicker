import type {
	ListResourcesOptions,
	PaginatedResourceList,
	ResourceEntry,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Lists sub-resources (CSS, JS, images, fonts, etc.) from the archive
 * with optional filtering by content type and origin.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns A paginated list of resource entries.
 */
export async function listResources(
	accessor: ArchiveAccessor,
	options: ListResourcesOptions = {},
): Promise<PaginatedResourceList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseQuery = knex('resources');

	if (options.contentType) {
		baseQuery.where('contentType', 'like', `${options.contentType}%`);
	}
	if (options.isExternal != null) {
		baseQuery.where('isExternal', options.isExternal ? 1 : 0);
	}

	const countResult = (await baseQuery.clone().count('id as total')) as {
		total: number;
	}[];
	// SQL count() always returns exactly one row
	const total = countResult[0]?.total ?? 0;

	const rows = await baseQuery
		.clone()
		.select(
			'url',
			'status',
			'contentType',
			'contentLength',
			'isExternal',
			'compress',
			'cdn',
		)
		.orderBy('url')
		.limit(limit)
		.offset(offset);

	const items: ResourceEntry[] = rows.map(
		(row: {
			url: string;
			status: number | null;
			contentType: string | null;
			contentLength: number | null;
			isExternal: 0 | 1;
			compress: string | 0;
			cdn: string | 0;
		}) => ({
			url: row.url,
			status: row.status,
			contentType: row.contentType,
			contentLength: row.contentLength,
			isExternal: !!row.isExternal,
			compress: row.compress === 0 ? null : row.compress,
			cdn: row.cdn === 0 ? null : row.cdn,
		}),
	);

	return {
		items,
		total: Number(total),
		offset,
		limit,
	};
}
