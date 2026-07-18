import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { getResourceUrlList } from './get-resource-url-list.js';

/**
 * Inserts one `url_refs` + `resource_items` pair.
 * @param db - Knex connected to the in-memory test DB.
 * @param url - URL string to register.
 */
async function seedResource(db: Knex, url: string): Promise<void> {
	const [urlRef] = await db('url_refs').insert({ url }).returning('id');
	await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });
}

describe('getResourceUrlList', () => {
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

	it('returns an empty array for an empty archive', async () => {
		expect(await getResourceUrlList(db)).toEqual([]);
	});

	it('returns every resource URL resolved through url_refs', async () => {
		await seedResource(db, 'https://example.com/style.css');
		await seedResource(db, 'https://example.com/app.js');
		const urls = await getResourceUrlList(db);
		expect(urls.toSorted()).toEqual([
			'https://example.com/app.js',
			'https://example.com/style.css',
		]);
	});

	it('does not include page URLs from content_items', async () => {
		await seedResource(db, 'https://example.com/style.css');
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		await db('content_items').insert({
			url_id: urlRef.id,
			scraped: 1,
			is_target: 1,
			is_external: 0,
		});
		expect(await getResourceUrlList(db)).toEqual(['https://example.com/style.css']);
	});
});
