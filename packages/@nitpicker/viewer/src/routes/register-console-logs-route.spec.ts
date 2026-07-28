import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_register_console_logs_route__',
);

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

describe('registerConsoleLogsRoute — /api/console-logs (integration)', () => {
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
			url: parseUrl('https://example.com/a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: NOOP_META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: NOOP_META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setConsoleLogs(
			'https://example.com/a',
			[],
			[
				{
					pageUrl: 'https://example.com/a',
					type: 'error',
					text: 'boom',
					args: [],
					ts: 1,
				},
				{
					pageUrl: 'https://example.com/a',
					type: 'warn',
					text: 'be careful',
					args: [],
					ts: 2,
				},
			],
		);
		await archive.setConsoleLogs(
			'https://example.com/b',
			[],
			[
				{
					pageUrl: 'https://example.com/b',
					type: 'error',
					text: 'boom',
					args: [],
					ts: 3,
				},
			],
		);

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
			publicDir: '/tmp/no-such-dir-register-console-logs-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('aggregates identical content across pages into one entry', async () => {
		const res = await app.request('/api/console-logs');
		const body = (await res.json()) as {
			items: { text: string; pageCount: number; totalCount: number }[];
			total: number;
		};
		expect(body.total).toBe(2);
		const boom = body.items.find((i) => i.text === 'boom');
		expect(boom?.pageCount).toBe(2);
		expect(boom?.totalCount).toBe(2);
	});

	it('filters by type', async () => {
		const res = await app.request('/api/console-logs?type=warn');
		const body = (await res.json()) as { items: { text: string }[]; total: number };
		expect(body.total).toBe(1);
		expect(body.items[0]!.text).toBe('be careful');
	});

	it('sorts by text ascending', async () => {
		const res = await app.request('/api/console-logs?sortBy=text&sortOrder=asc');
		const body = (await res.json()) as { items: { text: string }[] };
		expect(body.items.map((i) => i.text)).toEqual(['be careful', 'boom']);
	});
});
