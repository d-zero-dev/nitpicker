import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveTextRefs } from './resolve-text-refs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

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

describe('resolveTextRefs', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_resolve_text_refs__');
	const archiveFilePath = path.resolve(workingDir, 'resolve-text-refs-test.nitpicker');
	let archive: InstanceType<typeof Archive>;
	let textId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);
		await archive.setPage({
			url: parseUrl('https://example.com/page')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: {
				lang: null,
				title: 'Anchor text source',
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
		const row = await knex('text_refs').where('text', 'Anchor text source').first();
		textId = row.id;
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty map for an empty id list without querying', async () => {
		const result = await resolveTextRefs(archive.getKnex(), []);
		expect(result.size).toBe(0);
	});

	it('resolves ids to their text', async () => {
		const result = await resolveTextRefs(archive.getKnex(), [textId]);
		expect(result.get(textId)).toBe('Anchor text source');
	});

	it('filters out null entries before querying', async () => {
		const result = await resolveTextRefs(archive.getKnex(), [null, textId, null]);
		expect(result.size).toBe(1);
		expect(result.get(textId)).toBe('Anchor text source');
	});

	it('returns an empty map when every entry is null', async () => {
		const result = await resolveTextRefs(archive.getKnex(), [null, null]);
		expect(result.size).toBe(0);
	});
});
