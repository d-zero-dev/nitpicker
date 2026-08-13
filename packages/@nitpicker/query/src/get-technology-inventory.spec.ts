import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTechnologyInventory } from './get-technology-inventory.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_technology_inventory__');

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

describe('getTechnologyInventory', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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
			html: '<html></html>',
			meta: { tags: { detected: {}, entries: [] } } as never,
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
			html: '<html></html>',
			meta: { tags: { detected: {}, entries: [] } } as never,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const [{ id: pageIdA }] = await knex('content_items')
			.join('url_refs', 'content_items.url_id', 'url_refs.id')
			.where('url_refs.url', 'https://example.com/a')
			.select('content_items.id as id');
		const [{ id: pageIdB }] = await knex('content_items')
			.join('url_refs', 'content_items.url_id', 'url_refs.id')
			.where('url_refs.url', 'https://example.com/b')
			.select('content_items.id as id');

		// Two rows for the same technology with DIFFERENT categories, in an
		// order where the alphabetically-smallest ('analytics') is not the
		// first-written row ('cms') — exercises the "first non-null wins"
		// contract distinctly from a SQL MIN() aggregate.
		await knex('page_technologies').insert([
			{
				pageId: pageIdA,
				technology: 'Multi-Category Tech',
				category: 'cms',
				version: null,
				confidence: 60,
				signalCount: 1,
			},
			{
				pageId: pageIdB,
				technology: 'Multi-Category Tech',
				category: 'analytics',
				version: null,
				confidence: 40,
				signalCount: 1,
			},
		]);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('reports the first-written non-null category, not the alphabetically-smallest one', async () => {
		const entries = await getTechnologyInventory(archive);
		const entry = entries.find((e) => e.technology === 'Multi-Category Tech');
		expect(entry?.category).toBe('cms');
	});

	it('counts distinct pages and averages confidence per technology', async () => {
		const entries = await getTechnologyInventory(archive);
		const entry = entries.find((e) => e.technology === 'Multi-Category Tech');
		expect(entry?.pageCount).toBe(2);
		expect(entry?.avgConfidence).toBe(50);
	});
});
