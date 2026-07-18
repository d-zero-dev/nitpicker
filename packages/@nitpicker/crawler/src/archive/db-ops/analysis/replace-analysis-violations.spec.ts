import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';
import { seedContentItem } from '../../test-utils/seed-content-item.js';

import { replaceAnalysisViolations } from './replace-analysis-violations.js';

describe('replaceAnalysisViolations', () => {
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

	it('resolves violation URLs to content_items ids and persists rows', async () => {
		const pageId = await seedContentItem(db, 'https://example.com/');
		await replaceAnalysisViolations(db, [
			{
				validator: 'markuplint',
				severity: 'error',
				rule: 'required-attr',
				code: '<img>',
				message: 'Missing alt attribute',
				url: 'https://example.com/',
			},
		]);
		const rows = await db('analysis_violations').select('*');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			page_id: pageId,
			validator: 'markuplint',
			severity: 'error',
			rule: 'required-attr',
			page_url_sort_key: 'https://example.com/',
		});
	});

	it('replaces the previous violation set instead of appending', async () => {
		await seedContentItem(db, 'https://example.com/');
		const violation = {
			validator: 'markuplint',
			severity: 'error',
			rule: 'required-attr',
			message: 'Missing alt attribute',
			url: 'https://example.com/',
		};
		await replaceAnalysisViolations(db, [violation, { ...violation, rule: 'other' }]);
		await replaceAnalysisViolations(db, [violation]);
		const rows = await db('analysis_violations').select('*');
		expect(rows).toHaveLength(1);
	});

	it('clears all rows when given an empty set', async () => {
		await seedContentItem(db, 'https://example.com/');
		await replaceAnalysisViolations(db, [
			{
				validator: 'axe',
				severity: 'warning',
				rule: 'color-contrast',
				message: 'Low contrast',
				url: 'https://example.com/',
			},
		]);
		await replaceAnalysisViolations(db, []);
		expect(await db('analysis_violations').select('*')).toEqual([]);
		expect(await db('analysis_text_refs').select('*')).toEqual([]);
	});

	it('throws when a violation URL has no content_items row', async () => {
		await seedContentItem(db, 'https://example.com/');
		await expect(
			replaceAnalysisViolations(db, [
				{
					validator: 'axe',
					severity: 'error',
					rule: 'label',
					message: 'Missing label',
					url: 'https://example.com/missing',
				},
			]),
		).rejects.toThrow(/could not resolve 1 page URL/);
	});

	it('does not resolve URLs that only exist as resources', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/style.css' })
			.returning('id');
		await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });
		await expect(
			replaceAnalysisViolations(db, [
				{
					validator: 'axe',
					severity: 'error',
					rule: 'label',
					message: 'Missing label',
					url: 'https://example.com/style.css',
				},
			]),
		).rejects.toThrow(/could not resolve 1 page URL/);
	});

	it('deduplicates message and code text through analysis_text_refs', async () => {
		await seedContentItem(db, 'https://example.com/');
		await seedContentItem(db, 'https://example.com/a');
		const base = {
			validator: 'markuplint',
			severity: 'error',
			rule: 'required-attr',
			code: '<img>',
			message: 'Missing alt attribute',
		};
		await replaceAnalysisViolations(db, [
			{ ...base, url: 'https://example.com/' },
			{ ...base, url: 'https://example.com/a' },
		]);
		// Same message + same code across 2 violations → 2 text refs total.
		const textRefs = await db('analysis_text_refs').select('*');
		expect(textRefs).toHaveLength(2);
	});
});
