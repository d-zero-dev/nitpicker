import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupPhase6DDb } from '../phase6d/test-utils/setup-phase6d-db.js';

import { checkContentItemsCount } from './check-content-items-count.js';
import { Phase6VerificationError } from './types.js';

describe('checkContentItemsCount', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when content_items row count equals pages row count', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		await db('url_refs').insert([
			{ id: 1, url: 'https://example.com/a' },
			{ id: 2, url: 'https://example.com/b' },
		]);
		await db('content_items').insert([
			{ id: 1, url_id: 1, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
			{ id: 2, url_id: 2, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
		]);
		await expect(checkContentItemsCount(db)).resolves.toBeUndefined();
	});

	it('throws when content_items has more rows than pages', async () => {
		await db('pages').insert({
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
		});
		await db('url_refs').insert([
			{ id: 1, url: 'https://example.com/a' },
			{ id: 2, url: 'https://example.com/phantom' },
		]);
		await db('content_items').insert([
			{ id: 1, url_id: 1, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
			{ id: 2, url_id: 2, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
		]);
		await expect(checkContentItemsCount(db)).rejects.toBeInstanceOf(
			Phase6VerificationError,
		);
	});

	it('throws when content_items is missing rows', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		await db('url_refs').insert({ id: 1, url: 'https://example.com/a' });
		await db('content_items').insert({
			id: 1,
			url_id: 1,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
		});
		await expect(checkContentItemsCount(db)).rejects.toBeInstanceOf(
			Phase6VerificationError,
		);
	});

	it('includes both counts in the error context', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
		]);
		try {
			await checkContentItemsCount(db);
			expect.unreachable('expected Phase6VerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(Phase6VerificationError);
			const details = (error as Phase6VerificationError).details;
			expect(details.check).toContain('#1');
			expect(details.context?.content_items).toBe(0);
			expect(details.context?.pages).toBe(1);
		}
	});
});
