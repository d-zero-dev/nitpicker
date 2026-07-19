import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { readKeysetWindow } from './read-keyset-window.js';

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

const SPEC = { columns: ['url_sort_key', 'resource_id'], scanDirection: 'asc' } as const;

describe('readKeysetWindow', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_read_keyset_window__');
	const archiveFilePath = path.resolve(workingDir, 'read-keyset-window-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		for (const name of ['a.css', 'b.css', 'c.css']) {
			await archive.setResources({
				url: parseUrl(`https://example.com/${name}`)!,
				isExternal: false,
				isError: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/css',
				contentLength: 100,
				compress: false,
				cdn: false,
				headers: {},
			});
		}
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('applies filters, orders, and limits (+1 for hasMore detection)', async () => {
		const knex = archive.getKnex();
		const rows = await readKeysetWindow<
			(typeof SPEC)['columns'][number],
			{ resource_id: number; url_sort_key: string }
		>(knex, 'viewer_resources', () => {}, ['resource_id'], SPEC, 'asc', 2, undefined, 0);
		expect(rows).toHaveLength(3); // limit(2) + 1 = 3 rows exist total
		expect(rows.map((r) => r.url_sort_key)).toEqual([
			'https://example.com/a.css',
			'https://example.com/b.css',
			'https://example.com/c.css',
		]);
	});

	it('applies a keyset predicate to seek past a boundary row', async () => {
		const knex = archive.getKnex();
		const boundary = await knex('viewer_resources')
			.where('url_sort_key', 'https://example.com/a.css')
			.first<{ resource_id: number }>('resource_id');
		const rows = await readKeysetWindow<
			(typeof SPEC)['columns'][number],
			{ resource_id: number; url_sort_key: string }
		>(
			knex,
			'viewer_resources',
			() => {},
			['resource_id'],
			SPEC,
			'asc',
			10,
			{ operator: '>', values: ['https://example.com/a.css', boundary!.resource_id] },
			0,
		);
		expect(rows.map((r) => r.url_sort_key)).toEqual([
			'https://example.com/b.css',
			'https://example.com/c.css',
		]);
	});

	it('applies caller-supplied filters', async () => {
		const knex = archive.getKnex();
		const rows = await readKeysetWindow<
			(typeof SPEC)['columns'][number],
			{ resource_id: number; url_sort_key: string }
		>(
			knex,
			'viewer_resources',
			(qb) => qb.where('url_sort_key', 'https://example.com/b.css'),
			['resource_id'],
			SPEC,
			'asc',
			10,
			undefined,
			0,
		);
		expect(rows.map((r) => r.url_sort_key)).toEqual(['https://example.com/b.css']);
	});

	it('applies a direct offset when no keyset is supplied', async () => {
		const knex = archive.getKnex();
		const rows = await readKeysetWindow<
			(typeof SPEC)['columns'][number],
			{ resource_id: number; url_sort_key: string }
		>(knex, 'viewer_resources', () => {}, ['resource_id'], SPEC, 'asc', 10, undefined, 1);
		expect(rows.map((r) => r.url_sort_key)).toEqual([
			'https://example.com/b.css',
			'https://example.com/c.css',
		]);
	});

	it('ignores offset when a keyset is supplied', async () => {
		const knex = archive.getKnex();
		const boundary = await knex('viewer_resources')
			.where('url_sort_key', 'https://example.com/a.css')
			.first<{ resource_id: number }>('resource_id');
		const rows = await readKeysetWindow<
			(typeof SPEC)['columns'][number],
			{ resource_id: number; url_sort_key: string }
		>(
			knex,
			'viewer_resources',
			() => {},
			['resource_id'],
			SPEC,
			'asc',
			10,
			{ operator: '>', values: ['https://example.com/a.css', boundary!.resource_id] },
			1,
		);
		expect(rows.map((r) => r.url_sort_key)).toEqual([
			'https://example.com/b.css',
			'https://example.com/c.css',
		]);
	});
});
