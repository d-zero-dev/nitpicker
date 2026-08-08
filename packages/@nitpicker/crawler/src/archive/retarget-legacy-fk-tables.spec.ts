import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from './create-adjunct-tables.js';
import { createEntityTables } from './create-entity-tables.js';
import { createRefTables } from './create-ref-tables.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { retargetLegacyFkTables } from './retarget-legacy-fk-tables.js';
import { fkParentTables } from './test-utils/fk-parent-tables.js';
import { setupLegacyFkDb } from './test-utils/setup-legacy-fk-db.js';

const RETARGETED_TABLES = [
	'page_html_ref',
	'page_tags',
	'page_jsonld',
	'page_errors',
	'analysis_violations',
] as const;

/**
 * Seeds a legacy `pages` row and its PK-preserved `content_items` twin —
 * the shape the 0.13 populate step guarantees before retarget runs.
 * @param db - Knex connected to the test DB.
 * @param id - Explicit id shared by both rows.
 * @param url - Page URL registered in both `pages` and `url_refs`.
 */
async function seedPageAndContentItem(db: Knex, id: number, url: string): Promise<void> {
	await db('pages').insert({ id, url, scraped: 1, isTarget: 1, isExternal: 0 });
	const [urlRef] = await db('url_refs').insert({ url }).returning('id');
	await db('content_items').insert({
		id,
		url_id: urlRef.id,
		scraped: 1,
		is_target: 1,
		is_external: 0,
	});
}

describe('retargetLegacyFkTables', () => {
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
		await setupLegacyFkDb(db);
		await db.raw('PRAGMA foreign_keys = ON');
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('repoints every adjunct FK from pages(id) to content_items(id)', async () => {
		for (const table of RETARGETED_TABLES) {
			const parentsBefore = await fkParentTables(db, table);
			expect(parentsBefore.has('pages'), `${table} before`).toBe(true);
		}
		await db.transaction(async (trx) => {
			await retargetLegacyFkTables(trx);
		});
		for (const table of RETARGETED_TABLES) {
			const parents = await fkParentTables(db, table);
			expect(parents.has('content_items'), `${table} → content_items`).toBe(true);
			expect(parents.has('pages'), `${table} must not reference pages`).toBe(false);
		}
	});

	it('carries every row across the rebuild', async () => {
		await seedPageAndContentItem(db, 1, 'https://example.com/');
		await db('page_errors').insert({
			pageId: 1,
			phase: 'screenshot',
			message: 'viewport switch failed',
			createdAt: 1000,
		});
		await db('page_tags').insert({
			pageId: 1,
			provider: 'WordPress',
			category: 'CMS',
			externalId: 'wp',
			confidence: 100,
		});
		await db('page_jsonld').insert({
			pageId: 1,
			kind: 'json-ld',
			type: 'Article',
			raw: '{"@type":"Article"}',
		});
		await db('analysis_text_refs').insert({ id: 1, text: 'msg', sha256: 'x'.repeat(64) });
		await db('analysis_violations').insert({
			page_id: 1,
			validator: 'axe',
			severity: 'error',
			rule: 'label',
			message_text_id: 1,
			page_url_sort_key: 'https://example.com/',
			message_sort_key: 'msg',
			code_sort_key: '',
		});
		const hash = Buffer.alloc(32, 1);
		await db('page_html_blobs').insert({
			hash,
			body: Buffer.from('<html></html>'),
			codec: 'none',
			size_raw: 13,
			size_stored: 13,
		});
		await db('page_html_ref').insert({ page_id: 1, hash });

		await db.transaction(async (trx) => {
			await retargetLegacyFkTables(trx);
		});

		expect(await db('page_errors').select('*')).toMatchObject([
			{ pageId: 1, phase: 'screenshot', message: 'viewport switch failed' },
		]);
		expect(await db('page_tags').select('*')).toMatchObject([
			{ pageId: 1, provider: 'WordPress', externalId: 'wp' },
		]);
		expect(await db('page_jsonld').select('*')).toMatchObject([
			{ pageId: 1, kind: 'json-ld', type: 'Article' },
		]);
		expect(await db('analysis_violations').select('*')).toMatchObject([
			{ page_id: 1, validator: 'axe', rule: 'label', line: null, col: null },
		]);
		const htmlRefs = await db('page_html_ref').select('*');
		expect(htmlRefs).toHaveLength(1);
		expect(htmlRefs[0]?.page_id).toBe(1);
	});

	it('creates a missing adjunct table empty instead of failing', async () => {
		// A 0.10 archive that never ran `analyze` has no analysis tables at all.
		await db.raw('DROP TABLE "analysis_violations"');
		await db.raw('DROP TABLE "analysis_text_refs"');
		await db.transaction(async (trx) => {
			await retargetLegacyFkTables(trx);
		});
		expect(await db.schema.hasTable('analysis_violations')).toBe(true);
		expect(await db('analysis_violations').select('*')).toEqual([]);
		const parents = await fkParentTables(db, 'analysis_violations');
		expect(parents.has('content_items')).toBe(true);
	});

	it('aborts when a staged row references an id with no content_items twin', async () => {
		await seedPageAndContentItem(db, 1, 'https://example.com/');
		// A pages row whose content_items twin is missing — the populate
		// contract was violated upstream. The copy-back must fail under
		// PRAGMA foreign_keys = ON instead of persisting a dangling row.
		await db('pages').insert({
			id: 2,
			url: 'https://example.com/orphan',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
		});
		await db('page_errors').insert({
			pageId: 2,
			phase: 'render',
			message: 'orphan',
			createdAt: 0,
		});
		await expect(
			db.transaction(async (trx) => {
				await retargetLegacyFkTables(trx);
			}),
		).rejects.toThrow(/FOREIGN KEY constraint failed/);
	});

	it('aborts when a staged table is missing a column outside the nullable-on-retarget allowlist', async () => {
		// Unlike analysis_violations.line/col, this column loss is not on the
		// allowlist — it must still fail loudly rather than silently null-fill.
		await db.raw('ALTER TABLE page_errors DROP COLUMN "createdAt"');
		await seedPageAndContentItem(db, 1, 'https://example.com/');
		await db('page_errors').insert({ pageId: 1, phase: 'render', message: 'boom' });

		await expect(
			db.transaction(async (trx) => {
				await retargetLegacyFkTables(trx);
			}),
		).rejects.toThrow(/no such column/);
	});

	it('produces the same index name set as a fresh archive', async () => {
		await db.transaction(async (trx) => {
			await retargetLegacyFkTables(trx);
		});

		const fresh = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		try {
			await createRefTables(fresh);
			await createEntityTables(fresh);
			await createAdjunctTables(fresh);
			for (const table of RETARGETED_TABLES) {
				const migrated: { name: string }[] = await db
					.select('name')
					.from(db.raw('pragma_index_list(?)', [table]));
				const reference: { name: string }[] = await fresh
					.select('name')
					.from(fresh.raw('pragma_index_list(?)', [table]));
				expect(
					migrated.map((row) => row.name).toSorted(),
					`${table} index parity`,
				).toEqual(reference.map((row) => row.name).toSorted());
			}
		} finally {
			await fresh.destroy();
		}
	});
});
