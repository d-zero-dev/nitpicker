import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupPhase6DDb } from '../phase6d/test-utils/setup-phase6d-db.js';

import { checkContentTypePreservation } from './check-content-type-preservation.js';
import { Phase6VerificationError } from './types.js';

describe('checkContentTypePreservation', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
		await db('url_refs').insert([
			{ id: 1, url: 'https://example.com/a' },
			{ id: 2, url: 'https://example.com/b' },
			{ id: 3, url: 'https://example.com/c' },
		]);
		await db('content_type_refs').insert({
			id: 10,
			raw: 'text/html; charset=utf-8',
			normalized: 'text/html',
			category: 'html',
		});
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when every page with non-null contentType has a resolved content_type_id', async () => {
		await db('pages').insert([
			{
				id: 1,
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				contentType: 'text/html; charset=utf-8',
			},
		]);
		await db('content_items').insert({
			id: 1,
			url_id: 1,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
			content_type_id: 10,
		});
		await expect(checkContentTypePreservation(db)).resolves.toBeUndefined();
	});

	it('passes when contentType is null (id may legitimately be null)', async () => {
		await db('pages').insert([
			{ id: 2, url: 'https://example.com/b', scraped: 0, isTarget: 0, contentType: null },
		]);
		await db('content_items').insert({
			id: 2,
			url_id: 2,
			is_external: 0,
			scraped: 0,
			is_target: 0,
			source: 'crawled',
			content_type_id: null,
		});
		await expect(checkContentTypePreservation(db)).resolves.toBeUndefined();
	});

	it('passes when contentType is the empty string (treated as absent)', async () => {
		await db('pages').insert([
			{ id: 3, url: 'https://example.com/c', scraped: 1, isTarget: 1, contentType: '' },
		]);
		await db('content_items').insert({
			id: 3,
			url_id: 3,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
			content_type_id: null,
		});
		await expect(checkContentTypePreservation(db)).resolves.toBeUndefined();
	});

	it('throws when a page has non-null contentType but content_items.content_type_id is null', async () => {
		await db('pages').insert([
			{
				id: 1,
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				contentType: 'application/pdf',
			},
		]);
		await db('content_items').insert({
			id: 1,
			url_id: 1,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
			content_type_id: null,
		});
		await expect(checkContentTypePreservation(db)).rejects.toBeInstanceOf(
			Phase6VerificationError,
		);
	});

	it('emits the offending row id and content_type in the error context', async () => {
		await db('pages').insert([
			{
				id: 1,
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				contentType: 'application/pdf',
			},
		]);
		await db('content_items').insert({
			id: 1,
			url_id: 1,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
			content_type_id: null,
		});
		try {
			await checkContentTypePreservation(db);
			expect.unreachable('expected Phase6VerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(Phase6VerificationError);
			const details = (error as Phase6VerificationError).details;
			expect(details.check).toContain('#7');
			expect(details.context?.sample_page_id).toBe(1);
			expect(details.context?.sample_content_type).toBe('application/pdf');
		}
	});
});
