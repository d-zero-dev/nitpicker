import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedContentItems } from '../phase6d/test-utils/seed-content-items.js';
import { setupPhase6DDb } from '../phase6d/test-utils/setup-phase6d-db.js';

import { checkAnchorEdgesSum } from './check-anchor-edges-sum.js';
import { Phase6VerificationError } from './types.js';

describe('checkAnchorEdgesSum', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when SUM(anchor_edges.count) equals count(anchors)', async () => {
		await seedContentItems(db, [1, 2, 3]);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link' },
			{ pageId: 1, hrefId: 2, hash: 'b', textContent: 'link' },
			{ pageId: 1, hrefId: 3, hash: 'c', textContent: 'link' },
			{ pageId: 1, hrefId: 3, hash: 'd', textContent: 'link' },
			{ pageId: 1, hrefId: 3, hash: 'e', textContent: 'link' },
		]);
		await db('anchor_edges').insert([
			{ page_id: 1, href_page_id: 2, count: 2 },
			{ page_id: 1, href_page_id: 3, count: 3 },
		]);
		await expect(checkAnchorEdgesSum(db)).resolves.toBeUndefined();
	});

	it('passes when both tables are empty', async () => {
		await expect(checkAnchorEdgesSum(db)).resolves.toBeUndefined();
	});

	it('throws when SUM(count) undercounts anchors', async () => {
		await seedContentItems(db, [1, 2]);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link' },
			{ pageId: 1, hrefId: 2, hash: 'b', textContent: 'link' },
		]);
		await db('anchor_edges').insert({ page_id: 1, href_page_id: 2, count: 1 });
		await expect(checkAnchorEdgesSum(db)).rejects.toBeInstanceOf(Phase6VerificationError);
	});

	it('throws when SUM(count) overcounts anchors', async () => {
		await seedContentItems(db, [1, 2]);
		await db('anchors').insert({ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link' });
		await db('anchor_edges').insert({ page_id: 1, href_page_id: 2, count: 5 });
		await expect(checkAnchorEdgesSum(db)).rejects.toBeInstanceOf(Phase6VerificationError);
	});
});
