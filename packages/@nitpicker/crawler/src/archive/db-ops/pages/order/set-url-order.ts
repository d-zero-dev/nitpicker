import type { Knex } from 'knex';

import { pathComparator } from '@d-zero/shared/sort/path';

import { dbLog } from '../../../debug.js';

/**
 * Assigns natural URL sort order values (`content_items.crawl_order`) to
 * all internal pages. Pages are sorted using {@link pathComparator} and
 * assigned sequential order numbers.
 * @param knex - Knex query builder connected to the archive DB.
 */
export async function setUrlOrder(knex: Knex): Promise<void> {
	dbLog('Set URL Order');
	const res = (await knex
		.select('ci.id', 'ur.url')
		.from('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where('ci.is_external', '=', 0)) as { id: number; url: string }[];
	const sorted = res.toSorted((a, b) => pathComparator(a.url, b.url));

	// Batch update using chunked CASE statements to avoid N+1 queries
	const BATCH_SIZE = 500;
	for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
		const batch = sorted.slice(i, i + BATCH_SIZE);
		const ids = batch.map((row) => row.id);
		const bindings: (string | number)[] = [];
		const cases = batch
			.map((row, j) => {
				bindings.push(row.id, i + j + 1);
				return 'WHEN ? THEN ?';
			})
			.join(' ');
		const placeholders = ids.map(() => '?').join(',');
		await knex.raw(
			`UPDATE content_items SET crawl_order = CASE id ${cases} END WHERE id IN (${placeholders})`,
			[...bindings, ...ids],
		);
	}
}
