import type { PageData } from '../../../utils/types/types.js';
import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../../create-adjunct-tables.js';
import { createEntityTables } from '../../../create-entity-tables.js';
import { createRefTables } from '../../../create-ref-tables.js';
import { LibsqlDialect } from '../../../libsql-dialect.js';

import { insertTechnologies } from './insert-technologies.js';

/**
 * @param overrides - Fields to set on top of an empty Wappalyzer result.
 * @returns A `meta` with no Wappalyzer detections unless overridden.
 */
function makeMeta(overrides: Partial<PageData['meta']> = {}): PageData['meta'] {
	return { tags: { detected: {}, entries: [] }, ...overrides } as PageData['meta'];
}

describe('insertTechnologies', () => {
	let db: Knex;
	let pageId: number;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');
		pageId = page.id;
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('writes the structural signals found in the HTML and their roll-up', async () => {
		await db.transaction((trx) =>
			insertTechnologies(
				pageId,
				'<div id="app"><p data-v-1a2b3c4d>x</p></div>',
				makeMeta(),
				trx,
			),
		);

		const signals = await db('technology_signals')
			.where('pageId', pageId)
			.orderBy('id')
			.select('technology', 'signalType', 'evidence', 'weight');
		expect(signals).toEqual([
			{
				technology: 'Vue',
				signalType: 'scoped-attr',
				evidence: ' data-v-1a2b3c4d',
				weight: 40,
			},
			{ technology: 'Vue', signalType: 'weak-marker', evidence: ' id="app"', weight: 15 },
		]);
		const technologies = await db('page_technologies')
			.where('pageId', pageId)
			.select('technology', 'category', 'version', 'signalCount');
		expect(technologies).toEqual([
			{
				technology: 'Vue',
				category: 'JavaScript frameworks',
				version: null,
				signalCount: 2,
			},
		]);
	});

	it('writes generator signals for a page without HTML', async () => {
		await db.transaction((trx) =>
			insertTechnologies(pageId, '', makeMeta({ generator: 'Astro v4.2.0' }), trx),
		);

		const signals = await db('technology_signals')
			.where('pageId', pageId)
			.select('technology', 'signalType', 'evidence', 'weight');
		expect(signals).toEqual([
			{
				technology: 'Astro',
				signalType: 'meta-generator',
				evidence: 'Astro v4.2.0',
				weight: 85,
			},
		]);
	});

	it('keeps the previous rows when a re-scrape finds no signal', async () => {
		await db.transaction((trx) =>
			insertTechnologies(pageId, '<script src="/_next/a.js"></script>', makeMeta(), trx),
		);
		await db.transaction((trx) =>
			insertTechnologies(pageId, '<p>plain</p>', makeMeta(), trx),
		);

		const signals = await db('technology_signals')
			.where('pageId', pageId)
			.select('technology', 'signalType');
		expect(signals).toEqual([{ technology: 'Next.js', signalType: 'url-pattern' }]);
	});
});
