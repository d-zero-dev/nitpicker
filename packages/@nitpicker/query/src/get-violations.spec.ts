import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
			version: '0.10.0',
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

		// Write violations data directly into the archive tmpDir
		const violationsDir = path.resolve(archive.tmpDir, 'analysis');
		mkdirSync(violationsDir, { recursive: true });
		const violations = [
			{
				validator: 'axe',
				severity: 'error',
				rule: 'color-contrast',
				code: '<div>',
				message: 'Insufficient color contrast',
				url: 'https://example.com/',
			},
			{
				validator: 'axe',
				severity: 'warning',
				rule: 'image-alt',
				code: '<img>',
				message: 'Missing alt text',
				url: 'https://example.com/',
			},
			{
				validator: 'markuplint',
				severity: 'error',
				rule: 'no-hard-coded-color',
				code: '<span style="color:red">',
				message: 'Hard-coded color',
				url: 'https://example.com/',
			},
			{
				validator: 'textlint',
				severity: 'warning',
				rule: 'no-doubled-joshi',
				code: '',
				message: 'Doubled joshi',
				url: 'https://example.com/',
			},
		];
		writeFileSync(
			path.join(violationsDir, 'violations.json'),
			JSON.stringify(violations),
		);
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
			version: '0.10.0',
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
		// Don't write any violations file
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
