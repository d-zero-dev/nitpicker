import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupPhase6DDb } from '../phase6d/test-utils/setup-phase6d-db.js';

import { checkResourceItemsCount } from './check-resource-items-count.js';
import { Phase6VerificationError } from './types.js';

describe('checkResourceItemsCount', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when resource_items row count equals resources row count', async () => {
		await db('resources').insert([
			{ id: 1, url: 'https://cdn.example.com/a.js' },
			{ id: 2, url: 'https://cdn.example.com/b.js' },
		]);
		await db('url_refs').insert([
			{ id: 100, url: 'https://cdn.example.com/a.js' },
			{ id: 101, url: 'https://cdn.example.com/b.js' },
		]);
		await db('resource_items').insert([
			{ id: 1, url_id: 100, is_external: 0, source: 'crawled' },
			{ id: 2, url_id: 101, is_external: 0, source: 'crawled' },
		]);
		await expect(checkResourceItemsCount(db)).resolves.toBeUndefined();
	});

	it('passes when both tables are empty', async () => {
		await expect(checkResourceItemsCount(db)).resolves.toBeUndefined();
	});

	it('throws when resource_items has more rows than resources', async () => {
		await db('resources').insert({ id: 1, url: 'https://cdn.example.com/a.js' });
		await db('url_refs').insert([
			{ id: 100, url: 'https://cdn.example.com/a.js' },
			{ id: 101, url: 'https://cdn.example.com/phantom.js' },
		]);
		await db('resource_items').insert([
			{ id: 1, url_id: 100, is_external: 0, source: 'crawled' },
			{ id: 2, url_id: 101, is_external: 0, source: 'crawled' },
		]);
		await expect(checkResourceItemsCount(db)).rejects.toBeInstanceOf(
			Phase6VerificationError,
		);
	});

	it('throws when resource_items is missing rows', async () => {
		await db('resources').insert([
			{ id: 1, url: 'https://cdn.example.com/a.js' },
			{ id: 2, url: 'https://cdn.example.com/b.js' },
		]);
		await db('url_refs').insert({ id: 100, url: 'https://cdn.example.com/a.js' });
		await db('resource_items').insert({
			id: 1,
			url_id: 100,
			is_external: 0,
			source: 'crawled',
		});
		await expect(checkResourceItemsCount(db)).rejects.toBeInstanceOf(
			Phase6VerificationError,
		);
	});
});
