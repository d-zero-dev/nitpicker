import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { getViolations } from './get-violations.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_violations__');

describe('getViolations', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'violations-test.nitpicker');

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://example.com'],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><head><title>Test</title></head><body></body></html>',
			meta: {
				lang: 'ja',
				title: 'Test',
				description: null,
				keywords: null,
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: null,
				alternate: null,
				'og:type': null,
				'og:title': null,
				'og:site_name': null,
				'og:description': null,
				'og:url': null,
				'og:image': null,
				'twitter:card': null,
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const textRows = [
			{ id: 1, text: 'Insufficient color contrast', sha256: 'a1' },
			{ id: 2, text: 'Missing alt text', sha256: 'a2' },
			{ id: 3, text: 'Hard-coded color', sha256: 'a3' },
			{ id: 4, text: 'Doubled joshi', sha256: 'a4' },
			{ id: 5, text: '<div>', sha256: 'b1' },
			{ id: 6, text: '<img>', sha256: 'b2' },
			{ id: 7, text: '<span style="color:red">', sha256: 'b3' },
			{ id: 8, text: '', sha256: 'b4' },
		];
		await knex('analysis_text_refs').insert(textRows);
		await knex('analysis_violations').insert([
			{
				page_id: 1,
				validator: 'axe',
				severity: 'error',
				rule: 'color-contrast',
				message_text_id: 1,
				code_text_id: 5,
				page_url_sort_key: 'https://example.com/',
				message_sort_key: 'Insufficient color contrast',
				code_sort_key: '<div>',
			},
			{
				page_id: 1,
				validator: 'axe',
				severity: 'warning',
				rule: 'image-alt',
				message_text_id: 2,
				code_text_id: 6,
				page_url_sort_key: 'https://example.com/',
				message_sort_key: 'Missing alt text',
				code_sort_key: '<img>',
			},
			{
				page_id: 1,
				validator: 'markuplint',
				severity: 'error',
				rule: 'no-hard-coded-color',
				message_text_id: 3,
				code_text_id: 7,
				page_url_sort_key: 'https://example.com/',
				message_sort_key: 'Hard-coded color',
				code_sort_key: '<span style="color:red">',
			},
			{
				page_id: 1,
				validator: 'textlint',
				severity: 'warning',
				rule: 'no-doubled-joshi',
				message_text_id: 4,
				code_text_id: 8,
				page_url_sort_key: 'https://example.com/',
				message_sort_key: 'Doubled joshi',
				code_sort_key: '',
			},
		]);
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('全違反を取得する', async () => {
		const result = await getViolations(archive);
		expect(result.total).toBe(4);
		expect(result.items).toHaveLength(4);
	});

	it('validator でフィルタする', async () => {
		const result = await getViolations(archive, { validator: 'axe' });
		expect(result.total).toBe(2);
		expect(result.items.every((v) => v.validator === 'axe')).toBe(true);
	});

	it('severity でフィルタする', async () => {
		const result = await getViolations(archive, { severity: 'error' });
		expect(result.total).toBe(2);
		expect(result.items.every((v) => v.severity === 'error')).toBe(true);
	});

	it('rule でフィルタする', async () => {
		const result = await getViolations(archive, { rule: 'color-contrast' });
		expect(result.total).toBe(1);
		expect(result.items[0]?.rule).toBe('color-contrast');
	});

	it('複合フィルタが機能する', async () => {
		const result = await getViolations(archive, { validator: 'axe', severity: 'error' });
		expect(result.total).toBe(1);
		expect(result.items[0]?.rule).toBe('color-contrast');
	});

	it('ページネーションが機能する', async () => {
		const result = await getViolations(archive, { limit: 2, offset: 0 });
		expect(result.items).toHaveLength(2);
		expect(result.total).toBe(4);
	});

	it('offset が機能する', async () => {
		const result = await getViolations(archive, { limit: 2, offset: 2 });
		expect(result.items).toHaveLength(2);
		expect(result.total).toBe(4);
	});

	it('不正な limit はデフォルトに丸める', async () => {
		const negative = await getViolations(archive, { limit: -1 });
		expect(negative.items).toHaveLength(4);

		const fractional = await getViolations(archive, { limit: 1.5 });
		expect(fractional.items).toHaveLength(4);

		const infinite = await getViolations(archive, { limit: Number.POSITIVE_INFINITY });
		expect(infinite.items).toHaveLength(4);
	});

	it('不正な offset は 0 に丸める', async () => {
		const negative = await getViolations(archive, { limit: 2, offset: -1 });
		expect(negative.items).toHaveLength(2);
		expect(negative.items[0]?.message).toBe('Insufficient color contrast');

		const fractional = await getViolations(archive, { limit: 2, offset: 1.5 });
		expect(fractional.items).toHaveLength(2);
		expect(fractional.items[0]?.message).toBe('Insufficient color contrast');

		const infinite = await getViolations(archive, {
			limit: 2,
			offset: Number.POSITIVE_INFINITY,
		});
		expect(infinite.items).toHaveLength(2);
		expect(infinite.items[0]?.message).toBe('Insufficient color contrast');
	});

	it('urlPattern でフィルタする', async () => {
		const result = await getViolations(archive, { urlPattern: '%example.com%' });
		expect(result.total).toBe(4);
		expect(result.items.every((v) => v.url.includes('example.com'))).toBe(true);
	});

	it('sortBy と sortOrder を受け付ける', async () => {
		const result = await getViolations(archive, {
			sortBy: 'message',
			sortOrder: 'desc',
			limit: 1,
		});
		expect(result.items[0]?.message).toBe('Missing alt text');
	});

	it('違反エントリに必要なフィールドが含まれる', async () => {
		const result = await getViolations(archive, { limit: 1 });
		const entry = result.items[0]!;
		expect(entry).toHaveProperty('url');
		expect(entry).toHaveProperty('validator');
		expect(entry).toHaveProperty('severity');
		expect(entry).toHaveProperty('rule');
		expect(entry).toHaveProperty('message');
		expect(entry).toHaveProperty('code');
	});
});

describe('getViolations (analysis未実行)', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir2 = path.resolve(__dirname, '__test_fixtures_get_violations_empty__');

	beforeAll(async () => {
		mkdirSync(workingDir2, { recursive: true });

		archive = await Archive.create({
			filePath: path.resolve(workingDir2, 'empty-test.nitpicker'),
			cwd: workingDir2,
		});

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://example.com'],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: {
				lang: null,
				title: null,
				description: null,
				keywords: null,
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: null,
				alternate: null,
				'og:type': null,
				'og:title': null,
				'og:site_name': null,
				'og:description': null,
				'og:url': null,
				'og:image': null,
				'twitter:card': null,
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		// Do not seed analysis tables.
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		rmSync(workingDir2, { recursive: true, force: true });
	});

	it('analysis/violations が存在しない場合は空結果を返す', async () => {
		const result = await getViolations(archive);
		expect(result.items).toHaveLength(0);
		expect(result.total).toBe(0);
	});
});
