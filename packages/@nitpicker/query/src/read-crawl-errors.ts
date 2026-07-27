import type { ErrorRecord } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Read structured crawler-level failures from `crawl_errors`.
 *
 * Caller is responsible for `hasTable('crawl_errors')` gating because some
 * codepaths (e.g. `getErrorKinds`) want to branch on table presence AND
 * emptiness before deciding whether to fall back to `error.log`.
 * @param accessor - The opened archive accessor.
 * @returns Failure records (possibly empty).
 */
export async function readCrawlErrors(accessor: ArchiveAccessor): Promise<ErrorRecord[]> {
	const knex = accessor.getKnex();
	const rows = await knex('crawl_errors').select('url', 'message', 'createdAt');
	return rows.map((r: { url: string | null; message: string; createdAt: number }) => ({
		url: r.url ?? null,
		message: r.message,
		createdAt: r.createdAt,
	}));
}
