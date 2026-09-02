import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../../create-adjunct-tables.js';
import { createEntityTables } from '../../../create-entity-tables.js';
import { createRefTables } from '../../../create-ref-tables.js';
import { LibsqlDialect } from '../../../libsql-dialect.js';
import { seedContentItem } from '../../../test-utils/seed-content-item.js';

import { resetPagesByUrls } from './reset-pages-by-urls.js';

describe('resetPagesByUrls', () => {
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

	it('resets a normal scraped page and clears its derived rows', async () => {
		const url = 'https://example.com/normal';
		const pageId = await seedContentItem(db, url, { contentType: 'text/html' });
		await db('content_items')
			.where('id', pageId)
			.update({ status: 200, status_text: 'OK' });
		await db('page_meta').insert({ page_id: pageId, lang: 'en' });

		const result = await resetPagesByUrls(db, [url]);

		expect(result).toEqual({
			resetUrls: [url],
			excludedRedirects: [],
			excludedSkipped: [],
			excludedExternal: [],
		});
		const row = await db('content_items').where('id', pageId).first();
		expect(row.scraped).toBe(0);
		expect(row.status).toBeNull();
		expect(row.status_text).toBeNull();
		expect(row.content_type_id).toBeNull();
		const meta = await db('page_meta').where('page_id', pageId).first();
		expect(meta).toBeUndefined();
	});

	it('resets a page with a recorded 4xx/5xx status (unlike resetFailedPages, no permanent-kind exclusion)', async () => {
		const url = 'https://example.com/was-404';
		const pageId = await seedContentItem(db, url, { contentType: 'text/html' });
		await db('content_items')
			.where('id', pageId)
			.update({ status: 404, status_text: 'Not Found' });

		const result = await resetPagesByUrls(db, [url]);

		expect(result.resetUrls).toEqual([url]);
		const row = await db('content_items').where('id', pageId).first();
		expect(row.scraped).toBe(0);
		expect(row.status).toBeNull();
	});

	it('excludes a redirect source and leaves its row unchanged', async () => {
		const destId = await seedContentItem(db, 'https://example.com/dest');
		const url = 'https://example.com/redirect-source';
		const pageId = await seedContentItem(db, url);
		await db('content_items').where('id', pageId).update({ redirect_dest_id: destId });

		const result = await resetPagesByUrls(db, [url]);

		expect(result).toEqual({
			resetUrls: [],
			excludedRedirects: [url],
			excludedSkipped: [],
			excludedExternal: [],
		});
		const row = await db('content_items').where('id', pageId).first();
		expect(row.scraped).toBe(1);
		expect(row.redirect_dest_id).toBe(destId);
	});

	it('excludes an intentionally-skipped page and leaves its row unchanged', async () => {
		const url = 'https://example.com/skipped';
		const pageId = await seedContentItem(db, url);
		await db('content_items')
			.where('id', pageId)
			.update({ is_skipped: 1, skip_reason: 'excluded' });

		const result = await resetPagesByUrls(db, [url]);

		expect(result).toEqual({
			resetUrls: [],
			excludedRedirects: [],
			excludedSkipped: [url],
			excludedExternal: [],
		});
		const row = await db('content_items').where('id', pageId).first();
		expect(row.scraped).toBe(1);
		expect(row.is_skipped).toBe(1);
	});

	it('excludes an external page and leaves its row unchanged', async () => {
		const url = 'https://external.example/page';
		const pageId = await seedContentItem(db, url, { isExternal: 1 });

		const result = await resetPagesByUrls(db, [url]);

		expect(result).toEqual({
			resetUrls: [],
			excludedRedirects: [],
			excludedSkipped: [],
			excludedExternal: [url],
		});
		const row = await db('content_items').where('id', pageId).first();
		expect(row.scraped).toBe(1);
		expect(row.is_external).toBe(1);
	});

	it('deletes analysis_violations rows for a reset page but not analysis_text_refs', async () => {
		const url = 'https://example.com/with-violation';
		const pageId = await seedContentItem(db, url, { contentType: 'text/html' });
		const [textRef] = await db('analysis_text_refs')
			.insert({ text: 'some message', sha256: 'abc' })
			.returning('id');
		await db('analysis_violations').insert({
			page_id: pageId,
			validator: 'markuplint',
			severity: 'error',
			rule: 'rule-x',
			message_text_id: textRef.id,
			page_url_sort_key: url,
			message_sort_key: 'some message',
			code_sort_key: '',
		});

		await resetPagesByUrls(db, [url]);

		const violations = await db('analysis_violations').where('page_id', pageId);
		expect(violations).toHaveLength(0);
		const textRefs = await db('analysis_text_refs').where('id', textRef.id);
		expect(textRefs).toHaveLength(1);
	});

	it('is a no-op for a page that is already scraped = 0', async () => {
		const url = 'https://example.com/pending';
		await seedContentItem(db, url, { scraped: 0 });

		const result = await resetPagesByUrls(db, [url]);

		expect(result).toEqual({
			resetUrls: [],
			excludedRedirects: [],
			excludedSkipped: [],
			excludedExternal: [],
		});
	});

	it('returns an empty result for a URL not present in the archive', async () => {
		const result = await resetPagesByUrls(db, ['https://example.com/unknown']);

		expect(result).toEqual({
			resetUrls: [],
			excludedRedirects: [],
			excludedSkipped: [],
			excludedExternal: [],
		});
	});

	it('returns an empty result immediately for an empty urls array', async () => {
		const result = await resetPagesByUrls(db, []);

		expect(result).toEqual({
			resetUrls: [],
			excludedRedirects: [],
			excludedSkipped: [],
			excludedExternal: [],
		});
	});

	it('reports chunk progress via onProgress', async () => {
		const url = 'https://example.com/progress';
		await seedContentItem(db, url);

		const calls: [number, number][] = [];
		await resetPagesByUrls(db, [url], (processed, total) => {
			calls.push([processed, total]);
		});

		expect(calls).toEqual([[1, 1]]);
	});
});
