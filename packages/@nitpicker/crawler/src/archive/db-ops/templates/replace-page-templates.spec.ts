import type { TemplateClusterReason } from './types.js';
import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { createTemplateTables } from '../../create-template-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';
import { seedContentItem } from '../../test-utils/seed-content-item.js';
import { decodeJsonRef } from '../_shared/decode-json-ref.js';

import { replacePageTemplates } from './replace-page-templates.js';

const SAMPLE_REASON: TemplateClusterReason = {
	memberCount: 2,
	blocking: [
		{
			blockKey: 'css:abc',
			reason: { kind: 'css', distinctiveStylesheetHrefs: ['a.css'] },
		},
	],
	structuralCoreTokens: ['body>header', 'body>main'],
	landmarks: {
		header: {
			presenceRate: 1,
			chromeRate: 1,
			shellTokens: ['nav'],
			memberCountWithInstance: 2,
		},
	},
	siblingClusterKeys: [],
};

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
		await createTemplateTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('resolves page URLs to content_items ids and persists rows', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/', 'template-a']]),
		});

		const rows = await db('page_templates').select('*');
		expect(rows).toEqual([{ page_id: pageId, template_key: 'template-a' }]);
	});

	it('replaces the previous template set instead of appending', async () => {
		await seedContentItem(db, 'https://example.com/');
		await seedContentItem(db, 'https://example.com/a');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([
				['https://example.com/', 'template-a'],
				['https://example.com/a', 'template-b'],
			]),
		});
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/', 'template-a']]),
		});

		const rows = await db('page_templates').select('*');
		expect(rows).toHaveLength(1);
	});

	it('clears all rows when given an empty map', async () => {
		await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/', 'template-a']]),
		});
		await replacePageTemplates(db, { templateKeysByUrl: new Map() });

		expect(await db('page_templates').select('*')).toEqual([]);
	});

	it('silently skips a page URL that has no content_items row, without discarding the rest', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([
				['https://example.com/', 'template-a'],
				['https://example.com/missing', 'template-b'],
			]),
		});

		const rows = await db('page_templates').select('*');
		expect(rows).toEqual([{ page_id: pageId, template_key: 'template-a' }]);
	});

	it('does not resolve URLs that only exist as resources', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/style.css' })
			.returning('id');
		await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });

		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/style.css', 'template-a']]),
		});

		expect(await db('page_templates').select('*')).toEqual([]);
	});

	it('persists a cluster reason and round-trips it through decodeJsonRef', async () => {
		await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/', 'template-a']]),
			clusterReasonsByTemplateKey: new Map([['template-a', SAMPLE_REASON]]),
		});

		const rows = await db('page_template_clusters').select('*');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.template_key).toBe('template-a');
		expect(rows[0]?.member_count).toBe(2);
		const decoded = decodeJsonRef(rows[0]?.reason_json, rows[0]?.codec);
		expect(decoded && JSON.parse(decoded)).toEqual(SAMPLE_REASON);
	});

	it('clears the previous reason set when called again without one', async () => {
		await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/', 'template-a']]),
			clusterReasonsByTemplateKey: new Map([['template-a', SAMPLE_REASON]]),
		});
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/', 'template-a']]),
		});

		expect(await db('page_template_clusters').select('*')).toEqual([]);
	});

	it('labels every cluster on a first run, numbered per section by page count', async () => {
		await seedContentItem(db, 'https://example.com/events/1');
		await seedContentItem(db, 'https://example.com/events/2');
		await seedContentItem(db, 'https://example.com/events/3');
		await seedContentItem(db, 'https://example.com/news/1');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([
				['https://example.com/events/1', 'events-list'],
				['https://example.com/events/2', 'events-detail'],
				['https://example.com/events/3', 'events-detail'],
				['https://example.com/news/1', 'news'],
			]),
		});

		const labels = await db('page_template_labels').select('*').orderBy('template_key');
		expect(labels).toEqual([
			{ template_key: 'events-detail', section: 'events', ordinal: 1 },
			{ template_key: 'events-list', section: 'events', ordinal: 2 },
			{ template_key: 'news', section: 'news', ordinal: 1 },
		]);
	});

	it('carries a label forward to the renamed cluster that kept most of its pages', async () => {
		await seedContentItem(db, 'https://example.com/events/1');
		await seedContentItem(db, 'https://example.com/events/2');
		await seedContentItem(db, 'https://example.com/events/3');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([
				['https://example.com/events/1', 'run1-key'],
				['https://example.com/events/2', 'run1-key'],
				['https://example.com/events/3', 'run1-key'],
			]),
		});
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([
				['https://example.com/events/1', 'run2-key'],
				['https://example.com/events/2', 'run2-key'],
				['https://example.com/events/3', 'run2-other'],
			]),
		});

		const labels = await db('page_template_labels').select('*').orderBy('template_key');
		expect(labels).toEqual([
			{ template_key: 'run2-key', section: 'events', ordinal: 1 },
			{ template_key: 'run2-other', section: 'events', ordinal: 2 },
		]);
	});

	it('keeps the label rows of clusters that disappeared, so their letters are retired rather than re-issued two runs later', async () => {
		await seedContentItem(db, 'https://example.com/events/1');
		await seedContentItem(db, 'https://example.com/events/2');
		await seedContentItem(db, 'https://example.com/events/3');
		// Run 1: A (page 1), B (page 2).
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([
				['https://example.com/events/1', 'run1-a'],
				['https://example.com/events/2', 'run1-b'],
			]),
		});
		// Run 2: B's cluster vanishes.
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/events/1', 'run1-a']]),
		});
		expect(await db('page_template_labels').select('*').orderBy('template_key')).toEqual([
			{ template_key: 'run1-a', section: 'events', ordinal: 1 },
			{ template_key: 'run1-b', section: 'events', ordinal: 2 },
		]);
		// Run 3: a brand-new cluster must not become B.
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([
				['https://example.com/events/1', 'run1-a'],
				['https://example.com/events/3', 'run3-new'],
			]),
		});

		expect(await db('page_template_labels').select('*').orderBy('template_key')).toEqual([
			{ template_key: 'run1-a', section: 'events', ordinal: 1 },
			{ template_key: 'run1-b', section: 'events', ordinal: 2 },
			{ template_key: 'run3-new', section: 'events', ordinal: 3 },
		]);
	});

	it('overwrites the label row of a key that reappears with different pages instead of keeping the stale one', async () => {
		await seedContentItem(db, 'https://example.com/events/1');
		await seedContentItem(db, 'https://example.com/news/1');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/events/1', 'reused-key']]),
		});
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/news/1', 'reused-key']]),
		});

		expect(await db('page_template_labels').select('*')).toEqual([
			{ template_key: 'reused-key', section: 'news', ordinal: 1 },
		]);
	});

	it('leaves every label row in place when given an empty map', async () => {
		await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/', 'template-a']]),
		});
		await replacePageTemplates(db, { templateKeysByUrl: new Map() });

		expect(await db('page_templates').select('*')).toEqual([]);
		expect(await db('page_template_labels').select('*')).toEqual([
			{ template_key: 'template-a', section: null, ordinal: 1 },
		]);
	});

	it('does not label a page whose URL has no content_items row', async () => {
		await seedContentItem(db, 'https://example.com/');
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map([['https://example.com/missing', 'template-b']]),
		});

		expect(await db('page_template_labels').select('*')).toEqual([]);
	});

	it('persists a reason row even when its template key has no surviving member page', async () => {
		await replacePageTemplates(db, {
			templateKeysByUrl: new Map(),
			clusterReasonsByTemplateKey: new Map([['template-orphan', SAMPLE_REASON]]),
		});

		const rows = await db('page_template_clusters').select('template_key');
		expect(rows).toEqual([{ template_key: 'template-orphan' }]);
	});
});
