import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntityTables } from '../../../create-entity-tables.js';
import { createRefTables } from '../../../create-ref-tables.js';
import { LibsqlDialect } from '../../../libsql-dialect.js';
import { seedContentItem } from '../../../test-utils/seed-content-item.js';

import { getPageSourceByUrl } from './get-page-source-by-url.js';

describe('getPageSourceByUrl', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('returns the persisted source for a known URL', async () => {
		await seedContentItem(db, 'https://example.com/seed', {
			scraped: 0,
			isTarget: 0,
			source: 'inventory-seed',
		});
		expect(await getPageSourceByUrl(db, 'https://example.com/seed')).toBe(
			'inventory-seed',
		);
	});

	it('returns undefined for an unknown URL', async () => {
		await seedContentItem(db, 'https://example.com/known', { source: 'crawled' });
		expect(await getPageSourceByUrl(db, 'https://example.com/unknown')).toBeUndefined();
	});

	it('does not resolve a url_refs row that has no content_items row', async () => {
		// A URL can exist in the dictionary because a RESOURCE references it;
		// that must not read as a page source.
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/style.css' })
			.returning('id');
		await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });
		expect(await getPageSourceByUrl(db, 'https://example.com/style.css')).toBeUndefined();
	});
});
