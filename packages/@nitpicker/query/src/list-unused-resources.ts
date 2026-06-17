import type {
	ListUnusedResourcesOptions,
	PageSource,
	UnusedResourceEntry,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

/**
 * List internal sub-resources that no archived page references — "unused"
 * server-side files (CSS / JS / images / PDFs / fonts / …) that the crawl
 * touched the URL of (or that `crawl --inventory` registered) but no page
 * actually loads.
 *
 * "Unused" is judged purely by the referrer table:
 * `resources-referrers.resourceId IS NULL` means no `page → resource` edge
 * exists. The `resources.source` value is IGNORED in the WHERE clause and
 * returned only as a per-row badge, so a `'crawled'` resource that has lost
 * all referrers and an `'inventory-seed'` resource that never gained one
 * both surface here equally.
 *
 * External resources are excluded — only files served from the archived
 * scope are inventory candidates for "candidates to delete".
 *
 * Read-only — safe against viewer / stub-mode archives.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of unused resources with their `source` badge.
 */
export async function listUnusedResources(
	accessor: ArchiveAccessor,
	options: ListUnusedResourcesOptions = {},
): Promise<{ items: UnusedResourceEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseWhere = (qb: Knex.QueryBuilder): Knex.QueryBuilder =>
		qb
			.leftJoin(
				'resources-referrers',
				'resources.id',
				'=',
				'resources-referrers.resourceId',
			)
			.whereNull('resources-referrers.id')
			.where('resources.isExternal', 0);

	const countResult = (await baseWhere(knex('resources')).count(
		'resources.id as total',
	)) as {
		total: number;
	}[];
	const total = countResult[0]?.total ?? 0;

	const rows = (await baseWhere(knex('resources'))
		.select(
			'resources.url',
			'resources.status',
			'resources.contentType',
			'resources.contentLength',
			'resources.source',
		)
		.orderBy('resources.url')
		.limit(limit)
		.offset(offset)) as {
		url: string;
		status: number | null;
		contentType: string | null;
		contentLength: number | null;
		source: string | null;
	}[];

	const items: UnusedResourceEntry[] = rows.map((row) => ({
		url: row.url,
		status: row.status,
		contentType: row.contentType,
		contentLength: row.contentLength,
		// Tolerate pre-migration archives where the column is absent —
		// `?? 'crawled'` mirrors the DB DEFAULT.
		source: (row.source ?? 'crawled') as PageSource,
	}));

	return {
		items,
		total: Number(total),
	};
}
