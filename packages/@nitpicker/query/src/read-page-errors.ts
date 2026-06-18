import type { ErrorRecord } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Read scrape-path failures from `page_errors`, joined to `pages` for the URL.
 *
 * Older archives may predate the table, so existence is checked first and an
 * empty array is returned in that case — keeps the helper safe to call on any
 * archive without a separate migration step.
 * @param accessor - The opened archive accessor.
 * @returns Failure records (possibly empty).
 */
export async function readPageErrors(accessor: ArchiveAccessor): Promise<ErrorRecord[]> {
	const knex = accessor.getKnex();
	if (!(await knex.schema.hasTable('page_errors'))) {
		return [];
	}
	const rows = await knex('page_errors as e')
		.leftJoin('pages as p', 'p.id', 'e.pageId')
		.select('p.url as url', 'e.message as message');
	return rows.map((r: { url: string | null; message: string }) => ({
		url: r.url ?? null,
		message: r.message,
	}));
}
