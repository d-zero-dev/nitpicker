import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupMigrationDb } from '../populate-entity-tables/test-utils/setup-entities-db.js';

import { checkUrlRoundTrip } from './check-url-round-trip.js';
import { MigrationVerificationError } from './types.js';

describe('checkUrlRoundTrip', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when every sampled content_items row round-trips to its pages.url', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b?x=1', scraped: 1, isTarget: 1 },
		]);
		await db('url_refs').insert([
			{ id: 100, url: 'https://example.com/a' },
			{ id: 101, url: 'https://example.com/b?x=1' },
		]);
		await db('content_items').insert([
			{ id: 1, url_id: 100, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
			{ id: 2, url_id: 101, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
		]);
		await expect(checkUrlRoundTrip(db)).resolves.toBeUndefined();
	});

	it('early-returns when content_items is empty', async () => {
		await expect(checkUrlRoundTrip(db)).resolves.toBeUndefined();
	});

	it('throws when a content_items row points at the wrong url_refs entry', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		await db('url_refs').insert([
			{ id: 100, url: 'https://example.com/a' },
			{ id: 101, url: 'https://example.com/b' },
		]);
		// Cross the wires: content_items row 1 points to url 101 ("/b") but
		// its pages row still holds "/a".
		await db('content_items').insert([
			{ id: 1, url_id: 101, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
			{ id: 2, url_id: 100, is_external: 0, scraped: 1, is_target: 1, source: 'crawled' },
		]);
		await expect(checkUrlRoundTrip(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('throws when content_items.url_id points at a nonexistent url_refs id (FK gap)', async () => {
		// FKs are enforced by setupMigrationDb, so use raw statements after
		// switching them off — the FK gap is exactly the kind of orphan the
		// check should surface even in production, where the migration might
		// have skipped an insert.
		await db.raw('PRAGMA foreign_keys = OFF');
		await db('pages').insert({
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
		});
		await db('content_items').insert({
			id: 1,
			url_id: 999, // no matching url_refs row
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
		});
		await expect(checkUrlRoundTrip(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('throws when content_items has no matching pages row', async () => {
		await db.raw('PRAGMA foreign_keys = OFF');
		await db('url_refs').insert({ id: 100, url: 'https://example.com/a' });
		await db('content_items').insert({
			id: 1,
			url_id: 100,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
		});
		await expect(checkUrlRoundTrip(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('sampling is deterministic — the same archive always produces the same verdict', async () => {
		// Populate 2000 rows so stride sampling actually kicks in (stride = 2).
		const pages = Array.from({ length: 2000 }, (_, index) => ({
			id: index + 1,
			url: `https://example.com/p${index + 1}`,
			scraped: 1,
			isTarget: 1,
		}));
		const urlRefs = pages.map((p) => ({ id: p.id, url: p.url }));
		const contentItems = pages.map((p) => ({
			id: p.id,
			url_id: p.id,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
		}));
		await db.batchInsert('pages', pages, 500);
		await db.batchInsert('url_refs', urlRefs, 500);
		await db.batchInsert('content_items', contentItems, 500);
		// Corrupt exactly one page.url so the check should always trip on
		// that page. If the sampling missed even-numbered ids the run would
		// pass — stride sampling picks id % 2 = 0, i.e. all even ids, so
		// id=1000 is guaranteed to be in the sample.
		await db('pages').where('id', 1000).update({ url: 'https://example.com/CORRUPTED' });
		await expect(checkUrlRoundTrip(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
		await expect(checkUrlRoundTrip(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('emits the mismatching page id and both URLs in the error context', async () => {
		await db('pages').insert({
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
		});
		await db('url_refs').insert([
			{ id: 100, url: 'https://example.com/a' },
			{ id: 101, url: 'https://example.com/wrong' },
		]);
		await db('content_items').insert({
			id: 1,
			url_id: 101,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
		});
		try {
			await checkUrlRoundTrip(db);
			expect.unreachable('expected MigrationVerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationVerificationError);
			const details = (error as MigrationVerificationError).details;
			expect(details.check).toContain('#8');
			expect(details.context?.page_id).toBe(1);
			expect(details.context?.source_url).toBe('https://example.com/a');
			expect(details.context?.round_trip_url).toBe('https://example.com/wrong');
		}
	});
});
