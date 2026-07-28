import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';
import { seedContentItem } from '../../test-utils/seed-content-item.js';

import { replacePageTemplates } from './replace-page-templates.js';

describe('replacePageTemplates', () => {
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

	const NO_REASONS = new Map();

	it('resolves page URLs to content_items ids and persists rows', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(
			db,
			new Map([['https://example.com/', 'template-a']]),
			NO_REASONS,
		);

		const rows = await db('page_templates').select('*');
		expect(rows).toEqual([{ page_id: pageId, template_key: 'template-a' }]);
	});

	it('replaces the previous template set instead of appending', async () => {
		await seedContentItem(db, 'https://example.com/');
		await seedContentItem(db, 'https://example.com/a');
		await replacePageTemplates(
			db,
			new Map([
				['https://example.com/', 'template-a'],
				['https://example.com/a', 'template-b'],
			]),
			NO_REASONS,
		);
		await replacePageTemplates(
			db,
			new Map([['https://example.com/', 'template-a']]),
			NO_REASONS,
		);

		const rows = await db('page_templates').select('*');
		expect(rows).toHaveLength(1);
	});

	it('clears all rows when given an empty map', async () => {
		await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(
			db,
			new Map([['https://example.com/', 'template-a']]),
			NO_REASONS,
		);
		await replacePageTemplates(db, new Map(), NO_REASONS);

		expect(await db('page_templates').select('*')).toEqual([]);
	});

	it('silently skips a page URL that has no content_items row, without discarding the rest', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(
			db,
			new Map([
				['https://example.com/', 'template-a'],
				['https://example.com/missing', 'template-b'],
			]),
			NO_REASONS,
		);

		const rows = await db('page_templates').select('*');
		expect(rows).toEqual([{ page_id: pageId, template_key: 'template-a' }]);
	});

	it('does not resolve URLs that only exist as resources', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/style.css' })
			.returning('id');
		await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });

		await replacePageTemplates(
			db,
			new Map([['https://example.com/style.css', 'template-a']]),
			NO_REASONS,
		);

		expect(await db('page_templates').select('*')).toEqual([]);
	});

	it('persists cluster reasons and replaces them on the next run instead of appending', async () => {
		await seedContentItem(db, 'https://example.com/');
		const reason = {
			memberCount: 1,
			blocking: [
				{ blockKey: 'css:abc', reason: { kind: 'css', distinctiveStylesheetHrefs: [] } },
			],
			structuralCoreTokens: ['token-a'],
			landmarks: {},
			siblingClusterKeys: [],
		};
		await replacePageTemplates(
			db,
			new Map([['https://example.com/', 'template-a']]),
			new Map([['template-a', reason]]),
		);

		const rows = await db('page_template_cluster_reasons').select('*');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.template_key).toBe('template-a');
		expect(rows[0]?.member_count).toBe(1);
		expect(JSON.parse(rows[0]?.blocking as string)).toEqual(reason.blocking);
		expect(JSON.parse(rows[0]?.structural_core_tokens as string)).toEqual(
			reason.structuralCoreTokens,
		);

		await replacePageTemplates(db, new Map(), NO_REASONS);
		expect(await db('page_template_cluster_reasons').select('*')).toEqual([]);
	});
});
