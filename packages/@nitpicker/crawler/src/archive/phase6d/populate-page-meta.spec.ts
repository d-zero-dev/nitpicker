import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populatePhase6BRefs } from '../phase6b/populate-phase6b-refs.js';

import { populateContentItems } from './populate-content-items.js';
import { populatePageMeta } from './populate-page-meta.js';
import { countRows } from './test-utils/count-rows.js';
import { setupPhase6DDb } from './test-utils/setup-phase6d-db.js';

describe('populatePageMeta', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts one row per scraped page with resolved text / url ids', async () => {
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				title: 'Page A Title',
				description: 'A description',
				canonical: 'https://example.com/a',
				og_title: 'OG A',
				og_url: 'https://example.com/og-a',
				meta_extras: '{"foo":"bar"}',
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populatePageMeta(db);
		const row = await db('page_meta').where('page_id', 1).first();
		expect(row).toBeDefined();
		expect(row.title_text_id).not.toBeNull();
		expect(row.description_text_id).not.toBeNull();
		expect(row.canonical_url_id).not.toBeNull();
		expect(row.og_url_id).not.toBeNull();
		expect(row.meta_extras_json_id).not.toBeNull();
	});

	it('skips pages where scraped = 0 (acceptance count invariant)', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1, title: 'A' },
			{ url: 'https://example.com/b', scraped: 0, isTarget: 0, title: 'B' },
			{ url: 'https://example.com/c', scraped: 1, isTarget: 1, title: 'C' },
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populatePageMeta(db);
		const metaCount = await countRows(db, 'page_meta', 'page_id');
		const scrapedRows = await db('pages')
			.where('scraped', true)
			.count<{ n: number }[]>({ n: 'id' });
		const scrapedCount = Number(scrapedRows[0]!.n);
		expect(metaCount).toBe(scrapedCount);
		expect(metaCount).toBe(2);
	});

	it('is idempotent (upsert on page_id)', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1, title: 'A' },
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populatePageMeta(db);
		await populatePageMeta(db);
		expect(await countRows(db, 'page_meta', 'page_id')).toBe(1);
	});

	it('throws when a text_refs.id is not resolvable (Phase 6-B-2 not run)', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1, title: 'Missing text' },
		]);
		// Populate only URL refs; text_refs is left empty so `title` cannot resolve.
		await db('url_refs').insert({ url: 'https://example.com/a' });
		await populateContentItems(db);
		await expect(populatePageMeta(db)).rejects.toThrow(/text_refs\.id not resolved/);
	});

	it('drops large data URIs from URL columns with a warning', async () => {
		const longDataUri = 'data:image/png;base64,' + 'A'.repeat(600);
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				og_image: longDataUri,
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populatePageMeta(db);
		const row = await db('page_meta').where('page_id', 1).first();
		// og_image points at a large data URI that Phase 6-B-1 routed to
		// blob_refs, which page_meta cannot reference (no *_blob_id
		// column). The URL is dropped with a warning; the row still exists.
		expect(row.og_image_url_id).toBeNull();
	});

	it('preserves denormalised aggregates (tag_count, tags_providers_csv)', async () => {
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				tag_count: 5,
				jsonld_count: 2,
				tags_providers_csv: 'wordpress,gtm',
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populatePageMeta(db);
		const row = await db('page_meta').where('page_id', 1).first();
		expect(row.tag_count).toBe(5);
		expect(row.jsonld_count).toBe(2);
		expect(row.tags_providers_csv).toBe('wordpress,gtm');
	});
});
