import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_register_violations_route__');

const BASE_CONFIG = {
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
};

const NOOP_META = {
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
};

describe('registerViolationsRoute — /api/violations (integration)', () => {
	let app: ReturnType<typeof createApp>;
	let manager: ArchiveManager;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		const archive = await Archive.create({
			filePath: path.resolve(workingDir, 'fixture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(BASE_CONFIG);

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
			meta: NOOP_META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Same 4-violation fixture as `get-violations.spec.ts` — one row per
		// validator/severity combination so filters and OR-combination are
		// each independently distinguishable.
		const knex = archive.getKnex();
		await knex('analysis_text_refs').insert([
			{ id: 1, text: 'Insufficient color contrast', sha256: 'a1' },
			{ id: 2, text: 'Missing alt text', sha256: 'a2' },
			{ id: 3, text: 'Hard-coded color', sha256: 'a3' },
			{ id: 4, text: 'Doubled joshi', sha256: 'a4' },
			{ id: 5, text: '<div>', sha256: 'b1' },
			{ id: 6, text: '<img>', sha256: 'b2' },
			{ id: 7, text: '<span style="color:red">', sha256: 'b3' },
			{ id: 8, text: '', sha256: 'b4' },
		]);
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

		manager = new ArchiveManager();
		const { archiveId, mode } = await manager.open(archive.tmpDir);
		app = createApp({
			context: {
				manager,
				archiveId,
				filePath: archive.tmpDir,
				mode,
				crawlerLockHolder: null,
			},
			publicDir: '/tmp/no-such-dir-register-violations-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns every violation with no filters', async () => {
		const res = await app.request('/api/violations');
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(body.total).toBe(4);
		expect(body.items).toHaveLength(4);
	});

	it('filters by a single severity', async () => {
		const res = await app.request('/api/violations?severity=error');
		const body = (await res.json()) as {
			items: { severity: string }[];
			total: number;
		};
		expect(body.total).toBe(2);
		expect(body.items.every((v) => v.severity === 'error')).toBe(true);
	});

	it('OR-filters across a repeated severity query param', async () => {
		const res = await app.request('/api/violations?severity=error&severity=warning');
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(body.total).toBe(4);
	});

	it('filters by validator', async () => {
		const res = await app.request('/api/violations?validator=axe');
		const body = (await res.json()) as {
			items: { validator: string }[];
			total: number;
		};
		expect(body.total).toBe(2);
		expect(body.items.every((v) => v.validator === 'axe')).toBe(true);
	});

	it('filters by rule', async () => {
		const res = await app.request('/api/violations?rule=color-contrast');
		const body = (await res.json()) as { items: { rule: string }[]; total: number };
		expect(body.total).toBe(1);
		expect(body.items[0]!.rule).toBe('color-contrast');
	});

	it('filters by urlPattern', async () => {
		const res = await app.request(
			`/api/violations?urlPattern=${encodeURIComponent('%example.com%')}`,
		);
		const body = (await res.json()) as { items: { url: string }[]; total: number };
		expect(body.total).toBe(4);
		expect(body.items.every((v) => v.url.includes('example.com'))).toBe(true);
	});

	it('paginates via limit/offset without breaking the total count', async () => {
		const first = await app.request('/api/violations?limit=2&offset=0');
		const firstBody = (await first.json()) as { items: unknown[]; total: number };
		expect(firstBody.items).toHaveLength(2);
		expect(firstBody.total).toBe(4);

		const second = await app.request('/api/violations?limit=2&offset=2');
		const secondBody = (await second.json()) as { items: unknown[]; total: number };
		expect(secondBody.items).toHaveLength(2);
		expect(secondBody.total).toBe(4);
	});
});
