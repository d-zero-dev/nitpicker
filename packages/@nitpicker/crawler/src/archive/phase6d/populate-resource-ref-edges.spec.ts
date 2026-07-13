import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populatePhase6BRefs } from '../phase6b/populate-phase6b-refs.js';

import { populateContentItems } from './populate-content-items.js';
import { populateResourceItems } from './populate-resource-items.js';
import { populateResourceRefEdges } from './populate-resource-ref-edges.js';
import { countRows } from './test-utils/count-rows.js';
import { setupPhase6DDb } from './test-utils/setup-phase6d-db.js';

describe('populateResourceRefEdges', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('copies resources-referrers into resource_ref_edges with count=1 each', async () => {
		await db('pages').insert([
			{ id: 10, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 20, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		await db('resources').insert([{ id: 100, url: 'https://cdn.example.com/x.js' }]);
		await db('resources-referrers').insert([
			{ resourceId: 100, pageId: 10 },
			{ resourceId: 100, pageId: 20 },
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populateResourceItems(db);
		await populateResourceRefEdges(db);
		const rows = await db('resource_ref_edges')
			.select()
			.orderBy(['resource_id', 'page_id']);
		expect(rows).toEqual([
			{ resource_id: 100, page_id: 10, count: 1 },
			{ resource_id: 100, page_id: 20, count: 1 },
		]);
	});

	it('is idempotent', async () => {
		await db('pages').insert([
			{ id: 10, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
		]);
		await db('resources').insert([{ id: 100, url: 'https://cdn.example.com/x.js' }]);
		await db('resources-referrers').insert([{ resourceId: 100, pageId: 10 }]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populateResourceItems(db);
		await populateResourceRefEdges(db);
		await populateResourceRefEdges(db);
		expect(await countRows(db, 'resource_ref_edges', 'page_id')).toBe(1);
	});
});
