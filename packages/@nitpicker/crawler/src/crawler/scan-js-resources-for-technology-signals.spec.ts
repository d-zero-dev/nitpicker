import type { Server } from 'node:http';

import { createServer } from 'node:http';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import Archive from '../archive/archive.js';

import { scanJsResourcesForTechnologySignals } from './scan-js-resources-for-technology-signals.js';

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

/**
 * Starts a throwaway local HTTP server on an OS-assigned port so this scan
 * runs its real byte-cap streaming logic over a real socket.
 * @param handler - The request handler.
 * @returns The listening server and its base URL.
 */
async function startServer(
	handler: Parameters<typeof createServer>[0],
): Promise<{ server: Server; baseUrl: string }> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (address == null || typeof address === 'string') {
		throw new Error('Expected a network address');
	}
	return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('scanJsResourcesForTechnologySignals', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_scan_js_resources_for_technology_signals__',
	);
	let archive: Archive;
	let server: Server;
	let baseUrl: string;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		const started = await startServer((req, res) => {
			if (req.url === '/vue-bundle.js') {
				res.writeHead(200, { 'Content-Type': 'application/javascript' });
				res.end('/*!\n * Vue.js v3.4.21\n */\nconsole.log(1);');
				return;
			}
			if (req.url === '/plain-bundle.js') {
				res.writeHead(200, { 'Content-Type': 'application/javascript' });
				res.end('console.log("nothing interesting here");');
				return;
			}
			res.writeHead(404);
			res.end();
		});
		server = started.server;
		baseUrl = started.baseUrl;
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	afterEach(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
	});

	/**
	 * Builds a fresh archive with one page referencing one JS resource at
	 * `resourcePath` on the local test server.
	 * @param name - Unique archive file stem for this test.
	 * @param resourcePath - Path on the local server (e.g. `/vue-bundle.js`).
	 */
	async function setUpArchiveWithOneJsResource(name: string, resourcePath: string) {
		const archiveFilePath = path.resolve(workingDir, `${name}.nitpicker`);
		const created = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await created.setConfig(BASE_CONFIG);

		await created.setPage({
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
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const resourceUrl = `${baseUrl}${resourcePath}`;
		await created.setResources({
			url: parseUrl(resourceUrl)!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: { 'content-type': 'application/javascript' },
		});
		await created.setResourcesReferrers({
			url: 'https://example.com/',
			src: resourceUrl,
		});

		return created;
	}

	it('detects a known license comment and folds it into the referencing page', async () => {
		archive = await setUpArchiveWithOneJsResource('match', '/vue-bundle.js');

		const result = await scanJsResourcesForTechnologySignals(archive);

		expect(result).toMatchObject({
			candidateCount: 1,
			scannedCount: 1,
			matchedCount: 1,
			pagesUpdatedCount: 1,
		});

		const knex = archive.getKnex();
		const signalRows = await knex('technology_signals').select(
			'technology',
			'signalType',
			'weight',
		);
		expect(signalRows).toEqual([
			expect.objectContaining({
				technology: 'Vue',
				signalType: 'js-license-comment',
				weight: 55,
			}),
		]);

		const technologyRows = await knex('page_technologies').select(
			'technology',
			'confidence',
		);
		expect(technologyRows).toEqual([
			expect.objectContaining({ technology: 'Vue', confidence: 55 }),
		]);

		const cacheRows = await knex('technology_js_scan_cache').select('technology');
		expect(cacheRows).toEqual([expect.objectContaining({ technology: 'Vue' })]);
	});

	it('records a scanned-but-unmatched resource in the cache without touching page_technologies', async () => {
		archive = await setUpArchiveWithOneJsResource('no-match', '/plain-bundle.js');

		const result = await scanJsResourcesForTechnologySignals(archive);

		expect(result).toMatchObject({
			candidateCount: 1,
			scannedCount: 1,
			matchedCount: 0,
			pagesUpdatedCount: 0,
		});

		const knex = archive.getKnex();
		const cacheRows = await knex('technology_js_scan_cache').select('technology');
		expect(cacheRows).toEqual([expect.objectContaining({ technology: null })]);
		expect(await knex('page_technologies').select()).toEqual([]);
	});

	it('never re-scans a resource already present in technology_js_scan_cache', async () => {
		archive = await setUpArchiveWithOneJsResource('cached', '/vue-bundle.js');

		const first = await scanJsResourcesForTechnologySignals(archive);
		expect(first.scannedCount).toBe(1);

		const second = await scanJsResourcesForTechnologySignals(archive);
		expect(second).toMatchObject({ candidateCount: 0, scannedCount: 0, matchedCount: 0 });
	});

	it('preserves an existing page_technologies category/version not re-derivable from persisted signals', async () => {
		archive = await setUpArchiveWithOneJsResource('preserve-meta', '/vue-bundle.js');
		const knex = archive.getKnex();
		const [{ id: pageId }] = await knex('content_items').select('id');

		// Simulate a Flow-1 wappalyzer-only detection that already carried a
		// category and version `technology_signals` cannot itself persist.
		await knex('page_technologies').insert({
			pageId,
			technology: 'Vue',
			category: 'JavaScript frameworks',
			version: '3.9.9',
			confidence: 60,
			signalCount: 1,
		});

		await scanJsResourcesForTechnologySignals(archive);

		const [row] = await knex('page_technologies')
			.where({ pageId, technology: 'Vue' })
			.select('category', 'version', 'confidence');
		expect(row).toMatchObject({ category: 'JavaScript frameworks', version: '3.9.9' });
	});
});
