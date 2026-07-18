import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntityTables } from '../../../create-entity-tables.js';
import { createRefTables } from '../../../create-ref-tables.js';
import { LibsqlDialect } from '../../../libsql-dialect.js';
import { seedContentItem } from '../../../test-utils/seed-content-item.js';

import { getPageCount } from './get-page-count.js';

describe('getPageCount', () => {
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

	it('returns 0 for an empty archive', async () => {
		expect(await getPageCount(db)).toBe(0);
	});

	it('counts content_items rows', async () => {
		await seedContentItem(db, 'https://example.com/');
		await seedContentItem(db, 'https://example.com/a');
		await seedContentItem(db, 'https://example.com/b');
		expect(await getPageCount(db)).toBe(3);
	});

	it('does not count resource_items rows', async () => {
		await seedContentItem(db, 'https://example.com/');
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/style.css' })
			.returning('id');
		await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });
		expect(await getPageCount(db)).toBe(1);
	});
});
