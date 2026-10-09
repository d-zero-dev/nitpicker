import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupMigrationDb } from '../populate-entity-tables/test-utils/setup-entities-db.js';

import { checkPageMetaCount } from './check-page-meta-count.js';
import { MigrationVerificationError } from './types.js';

describe('checkPageMetaCount', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
		// This check only exercises row counts; skipping FK enforcement lets
		// the spec insert `page_meta` rows without also seeding matching
		// `content_items` / `url_refs` rows (those FKs are covered by the
		// 0.13 populate specs).
		await db.raw('PRAGMA foreign_keys = OFF');
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when page_meta row count equals count of scraped pages', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 0, isTarget: 0 },
			{ id: 3, url: 'https://example.com/c', scraped: 1, isTarget: 1 },
		]);
		await db('page_meta').insert([{ page_id: 1 }, { page_id: 3 }]);
		await expect(checkPageMetaCount(db)).resolves.toBeUndefined();
	});

	it('ignores un-scraped pages in the count', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 0, isTarget: 0 },
			{ id: 2, url: 'https://example.com/b', scraped: 0, isTarget: 0 },
		]);
		await expect(checkPageMetaCount(db)).resolves.toBeUndefined();
	});

	it('throws when page_meta has fewer rows than scraped pages', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		await db('page_meta').insert({ page_id: 1 });
		await expect(checkPageMetaCount(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('throws when page_meta has extra rows past scraped pages', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 0, isTarget: 0 },
		]);
		await db('page_meta').insert([{ page_id: 1 }, { page_id: 2 }]);
		await expect(checkPageMetaCount(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});
});
