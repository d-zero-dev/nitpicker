import type { GraphEdgeInsertRow } from './types.js';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from './build-viewer-read-model.js';
import { computeGraphReadModelRows } from './compute-graph-read-model-rows.js';

/**
 * Drains {@link computeGraphReadModelRows}'s chunks into one flat array, for
 * tests that only care about the full result.
 * @param trx - An open Knex transaction.
 * @param chunkSize - Forwarded to {@link computeGraphReadModelRows}.
 * @param onProgress - Forwarded to {@link computeGraphReadModelRows}.
 * @returns Every yielded edge row, concatenated in read order.
 */
async function collectGraphEdgeRows(
	trx: Knex,
	chunkSize?: number,
	onProgress?: (scannedUpToEdgeId: number, maxEdgeId: number) => void,
): Promise<GraphEdgeInsertRow[]> {
	const edges: GraphEdgeInsertRow[] = [];
	for await (const chunk of computeGraphReadModelRows(trx, chunkSize, onProgress)) {
		edges.push(...chunk);
	}
	return edges;
}

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

const META = {
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

describe('computeGraphReadModelRows', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_compute_graph_rows__');
	const archiveFilePath = path.resolve(workingDir, 'compute-graph-rows-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);
		const pageBase = {
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			imageList: [],
			isSkipped: false,
		};
		await archive.setPage({
			...pageBase,
			url: parseUrl('https://example.com/')!,
			meta: { ...META, title: 'Home' },
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About',
				},
			],
		});
		await archive.setPage({
			...pageBase,
			url: parseUrl('https://example.com/about')!,
			meta: { ...META, title: 'About' },
			anchorList: [
				{
					href: parseUrl('https://example.com/')!,
					isExternal: false,
					title: null,
					textContent: 'Home',
				},
			],
		});
		// The generator reads the already-built `viewer_anchor_facts` /
		// `viewer_pages` tables, not the write model — build them first.
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('yields every internal-HTML edge from viewer_anchor_facts', async () => {
		const knex = archive.getKnex();
		const edges = await knex.transaction((trx) => collectGraphEdgeRows(trx));

		expect(edges).toHaveLength(2);
		const pairs = edges
			.map((edge) => `${edge.source_page_id}->${edge.target_page_id}`)
			.toSorted();
		expect(new Set(pairs).size).toBe(2);
	});

	it('reads across multiple chunkSize-bounded chunks without losing or duplicating rows', async () => {
		const knex = archive.getKnex();
		const all = await knex.transaction((trx) => collectGraphEdgeRows(trx));
		const chunked = await knex.transaction((trx) => collectGraphEdgeRows(trx, 1));

		expect(chunked).toEqual(all);
	});

	it('throws on a non-positive chunkSize instead of silently yielding nothing or looping forever', async () => {
		const knex = archive.getKnex();
		await expect(knex.transaction((trx) => collectGraphEdgeRows(trx, 0))).rejects.toThrow(
			RangeError,
		);
		await expect(
			knex.transaction((trx) => collectGraphEdgeRows(trx, -1)),
		).rejects.toThrow(RangeError);
	});

	it('reports keyset scan progress up to the max viewer_anchor_facts edge_id (issue #294)', async () => {
		const knex = archive.getKnex();
		const calls: [number, number][] = [];
		await knex.transaction((trx) =>
			collectGraphEdgeRows(trx, 1, (scannedUpToEdgeId, maxEdgeId) => {
				calls.push([scannedUpToEdgeId, maxEdgeId]);
			}),
		);

		expect(calls.length).toBeGreaterThan(0);
		const maxEdgeId = calls[0]![1];
		expect(maxEdgeId).toBeGreaterThan(0);
		for (const [scannedUpToEdgeId, total] of calls) {
			expect(total).toBe(maxEdgeId);
			expect(scannedUpToEdgeId).toBeLessThanOrEqual(maxEdgeId);
		}
		for (let i = 1; i < calls.length; i++) {
			expect(calls[i]![0]).toBeGreaterThanOrEqual(calls[i - 1]![0]);
		}
		expect(calls.at(-1)![0]).toBe(maxEdgeId);
	});
});
