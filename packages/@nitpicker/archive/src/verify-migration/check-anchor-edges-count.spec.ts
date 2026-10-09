import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedContentItems } from '../populate-entity-tables/test-utils/seed-content-items.js';
import { setupMigrationDb } from '../populate-entity-tables/test-utils/setup-entities-db.js';

import { checkAnchorEdgesCount } from './check-anchor-edges-count.js';
import { MigrationVerificationError } from './types.js';

describe('checkAnchorEdgesCount', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when anchor_edges > 0 and < anchors', async () => {
		await seedContentItems(db, [1, 2]);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link' },
			{ pageId: 1, hrefId: 2, hash: 'b', textContent: 'link' },
			{ pageId: 1, hrefId: 2, hash: 'c', textContent: 'link' },
		]);
		await db('anchor_edges').insert({ page_id: 1, href_page_id: 2, count: 3 });
		await expect(checkAnchorEdgesCount(db)).resolves.toBeUndefined();
	});

	it('passes when both anchors and anchor_edges are empty', async () => {
		await expect(checkAnchorEdgesCount(db)).resolves.toBeUndefined();
	});

	it('throws when anchor_edges is empty but anchors is non-empty', async () => {
		await seedContentItems(db, [1, 2]);
		await db('anchors').insert({ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link' });
		await expect(checkAnchorEdgesCount(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('passes when anchor_edges equals anchors count (all pairs unique — small crawls)', async () => {
		await seedContentItems(db, [1, 2, 3]);
		// Every (pageId, hrefId) pair is unique, so dedup preserves the row
		// count. Check #4 (sum == count) still holds because each edge has
		// count = 1.
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link1' },
			{ pageId: 1, hrefId: 3, hash: 'b', textContent: 'link2' },
		]);
		await db('anchor_edges').insert([
			{ page_id: 1, href_page_id: 2, count: 1 },
			{ page_id: 1, href_page_id: 3, count: 1 },
		]);
		await expect(checkAnchorEdgesCount(db)).resolves.toBeUndefined();
	});

	it('throws when anchor_edges exceeds anchors (phantom rows)', async () => {
		await seedContentItems(db, [1, 2, 3]);
		await db('anchors').insert({ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link' });
		await db('anchor_edges').insert([
			{ page_id: 1, href_page_id: 2, count: 1 },
			{ page_id: 1, href_page_id: 3, count: 1 },
		]);
		await expect(checkAnchorEdgesCount(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('throws when anchor_edges is non-empty but anchors is empty', async () => {
		await seedContentItems(db, [1, 2]);
		await db('anchor_edges').insert({ page_id: 1, href_page_id: 2, count: 1 });
		await expect(checkAnchorEdgesCount(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});
});
