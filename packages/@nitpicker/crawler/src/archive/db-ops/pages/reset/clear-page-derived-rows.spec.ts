import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../../create-adjunct-tables.js';
import { createEntityTables } from '../../../create-entity-tables.js';
import { createRefTables } from '../../../create-ref-tables.js';
import { LibsqlDialect } from '../../../libsql-dialect.js';
import { seedContentItem } from '../../../test-utils/seed-content-item.js';

import { clearPageDerivedRows } from './clear-page-derived-rows.js';

/** Every table `clearPageDerivedRows` deletes from, keyed by its own FK column name. */
const DERIVED_TABLES: ReadonlyArray<readonly [string, string]> = [
	['page_meta', 'page_id'],
	['anchor_edges', 'page_id'],
	['image_items', 'page_id'],
	['resource_ref_edges', 'page_id'],
	['page_html_ref', 'page_id'],
	['technology_signals', 'pageId'],
	['page_technologies', 'pageId'],
	['page_jsonld', 'pageId'],
	['page_main_content_headings', 'pageId'],
	['page_main_content_images', 'pageId'],
	['page_main_content_tables', 'pageId'],
	['page_main_content_buttons', 'pageId'],
	['page_main_content_iframes', 'pageId'],
	['page_main_content_videos', 'pageId'],
	['page_main_content_audios', 'pageId'],
	['page_main_content_canvases', 'pageId'],
	['page_main_content_custom_elements', 'pageId'],
];

/**
 * Inserts one row into every table `clearPageDerivedRows` touches, all
 * pointing at `pageId` (`anchor_edges` also needs a second page as its
 * `href_page_id` destination; `resource_ref_edges` needs a `resource_items`
 * row).
 * @param db - Knex connected to the in-memory test DB.
 * @param pageId - The `content_items.id` every derived row is scoped to.
 * @param otherPageId - A second page id used as `anchor_edges.href_page_id`.
 */
async function seedAllDerivedRows(
	db: Knex,
	pageId: number,
	otherPageId: number,
): Promise<void> {
	await db('page_meta').insert({ page_id: pageId });
	await db('anchor_edges').insert({
		page_id: pageId,
		href_page_id: otherPageId,
		count: 1,
	});
	const [textRef] = await db('text_refs')
		.insert({ hash: Buffer.from([pageId]), text: `alt text ${pageId}` })
		.returning('id');
	await db('image_items').insert({ page_id: pageId, dom_path_text_id: textRef.id });
	const [resourceUrlRef] = await db('url_refs')
		.insert({ url: `https://example.com/resource-${pageId}.js` })
		.returning('id');
	const [resource] = await db('resource_items')
		.insert({ url_id: resourceUrlRef.id, is_external: 0 })
		.returning('id');
	await db('resource_ref_edges').insert({
		resource_id: resource.id,
		page_id: pageId,
		count: 1,
	});
	const hash = Buffer.alloc(32, pageId);
	await db('page_html_blobs').insert({
		hash,
		body: Buffer.from('<html></html>'),
		codec: 'none',
		size_raw: 13,
		size_stored: 13,
	});
	await db('page_html_ref').insert({ page_id: pageId, hash });
	await db('technology_signals').insert({
		pageId,
		technology: 'react',
		signalType: 'meta-generator',
		weight: 1,
	});
	await db('page_technologies').insert({
		pageId,
		technology: 'react',
		confidence: 1,
		signalCount: 1,
	});
	await db('page_jsonld').insert({ pageId, kind: 'ld+json', raw: '{}' });
	await db('page_main_content_headings').insert({ pageId, order: 0, level: 1 });
	await db('page_main_content_images').insert({
		pageId,
		order: 0,
		src: 'a.png',
		alt: '',
	});
	await db('page_main_content_tables').insert({
		pageId,
		order: 0,
		rows: 1,
		cols: 1,
		hasHeader: false,
		hasFooter: false,
		hasMergedCell: false,
	});
	await db('page_main_content_buttons').insert({
		pageId,
		order: 0,
		nodeName: 'BUTTON',
		disabled: false,
	});
	await db('page_main_content_iframes').insert({ pageId, order: 0, src: 'a.html' });
	await db('page_main_content_videos').insert({
		pageId,
		order: 0,
		src: 'a.mp4',
		width: 1,
		height: 1,
	});
	await db('page_main_content_audios').insert({ pageId, order: 0, src: 'a.mp3' });
	await db('page_main_content_canvases').insert({
		pageId,
		order: 0,
		width: 1,
		height: 1,
	});
	await db('page_main_content_custom_elements').insert({
		pageId,
		order: 0,
		nodeName: 'my-widget',
	});
}

describe('clearPageDerivedRows', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('deletes every derived row for the given page id, across all 17 tables', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/target');
		const otherPageId = await seedContentItem(db, 'https://example.com/other');
		await seedAllDerivedRows(db, pageId, otherPageId);

		await clearPageDerivedRows(db, [pageId]);

		for (const [table, column] of DERIVED_TABLES) {
			const rows = await db(table).where(column, pageId);
			expect(rows, `${table} should be empty for page ${pageId}`).toHaveLength(0);
		}
	});

	it('leaves another page’s derived rows untouched', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/target');
		const otherPageId = await seedContentItem(db, 'https://example.com/other');
		await seedAllDerivedRows(db, pageId, otherPageId);
		// Also seed `otherPageId` itself so it has its own derived rows,
		// distinct from being merely `anchor_edges.href_page_id` above.
		const thirdPageId = await seedContentItem(db, 'https://example.com/third');
		await seedAllDerivedRows(db, otherPageId, thirdPageId);

		await clearPageDerivedRows(db, [pageId]);

		for (const [table, column] of DERIVED_TABLES) {
			const rows = await db(table).where(column, otherPageId);
			expect(
				rows,
				`${table} should still have a row for page ${otherPageId}`,
			).toHaveLength(1);
		}
	});

	it('does not touch page_errors — that table is outside this shared helper', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/target');
		await db('page_errors').insert({
			pageId,
			phase: 'imageCapture',
			message: 'timeout',
			createdAt: 1_700_000_000_000,
		});

		await clearPageDerivedRows(db, [pageId]);

		const rows = await db('page_errors').where('pageId', pageId);
		expect(rows).toHaveLength(1);
	});

	it('is a no-op for an empty pageIds array', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/target');
		const otherPageId = await seedContentItem(db, 'https://example.com/other');
		await seedAllDerivedRows(db, pageId, otherPageId);

		await expect(clearPageDerivedRows(db, [])).resolves.toBeUndefined();

		const rows = await db('page_meta').where('page_id', pageId);
		expect(rows).toHaveLength(1);
	});
});
