import type { AnchorEdgeRow } from './types.js';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scanAnchorEdges } from './scan-anchor-edges.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(dirname, '__test_fixtures_scan_anchor_edges__');

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
 * Creates an archive with the default test configuration.
 * @param fileName - The archive file name inside the working directory.
 */
async function createArchive(fileName: string) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, fileName),
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
	return archive;
}

/**
 * Writes one internal page that links to `links`.
 * @param archive - The archive to write into.
 * @param url - The page URL.
 * @param links - The URLs it links to.
 */
async function writePage(
	archive: InstanceType<typeof Archive>,
	url: string,
	links: readonly string[],
) {
	await archive.setPage({
		url: parseUrl(url)!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '<html></html>',
		meta: { ...META, title: url },
		anchorList: links.map((href) => ({
			href: parseUrl(href)!,
			isExternal: false,
			title: null,
			textContent: href,
		})),
		imageList: [],
		isSkipped: false,
	});
}

/**
 * Runs the scan and keeps the chunks it delivered.
 * @param archive - The archive to scan.
 * @param chunkSize - Rows per chunk, or `undefined` for the default.
 */
async function scan(archive: InstanceType<typeof Archive>, chunkSize?: number) {
	const chunks: AnchorEdgeRow[][] = [];
	await scanAnchorEdges({
		knex: archive.getKnex(),
		chunkSize,
		onChunk: (rows) => {
			chunks.push([...rows]);
		},
	});
	return chunks;
}

/**
 * Runs the scan and returns every edge it delivered, chunk boundaries gone.
 * @param archive - The archive to scan.
 * @param chunkSize - Rows per chunk.
 */
async function scanEdges(archive: InstanceType<typeof Archive>, chunkSize: number) {
	const chunks = await scan(archive, chunkSize);
	return chunks.flat();
}

describe('scanAnchorEdges', () => {
	let archive: InstanceType<typeof Archive>;
	let emptyArchive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		archive = await createArchive('edges.nitpicker');
		// Five edges, from three pages, two of the pages linking more than once.
		await writePage(archive, 'https://example.com/a', [
			'https://example.com/b',
			'https://example.com/c',
		]);
		await writePage(archive, 'https://example.com/b', ['https://example.com/a']);
		await writePage(archive, 'https://example.com/c', [
			'https://example.com/a',
			'https://example.com/b',
		]);

		emptyArchive = await createArchive('no-edges.nitpicker');
		await writePage(emptyArchive, 'https://example.com/only', []);
	});

	afterAll(async () => {
		await archive.close();
		await emptyArchive.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('hands every edge over once, in chunks of the given size', async () => {
		const chunks = await scan(archive, 2);
		expect(chunks.map((chunk) => chunk.length)).toStrictEqual([2, 2, 1]);
	});

	it('delivers the edges in (page, href) order across chunk boundaries', async () => {
		const edges = await scanEdges(archive, 2);
		const pairs = edges.map((edge) => [edge.pageId, edge.hrefId]);
		expect(pairs).toStrictEqual(pairs.toSorted((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
		expect(new Set(pairs.map((pair) => pair.join('>'))).size).toBe(5);
	});

	it('resumes correctly after every single row, even where the page stays the same', async () => {
		const byOne = await scanEdges(archive, 1);
		const whole = await scanEdges(archive, 100);
		expect(byOne).toStrictEqual(whole);
		expect(byOne).toHaveLength(5);
	});

	it('delivers everything as one chunk when the chunk is larger than the table', async () => {
		const chunks = await scan(archive, 100);
		expect(chunks.map((chunk) => chunk.length)).toStrictEqual([5]);
	});

	/**
	 * Runs the scan and returns the row counts it asked the database for, one
	 * per statement it sent.
	 * @param chunkSize - Rows per chunk, or `undefined` for the default.
	 */
	async function requestedRows(chunkSize?: number) {
		const knex = archive.getKnex();
		const requested: unknown[] = [];
		const listener = (query: { bindings: unknown[] }) => {
			requested.push(query.bindings.at(-1));
		};
		knex.on('query', listener);
		try {
			await scan(archive, chunkSize);
		} finally {
			knex.removeListener('query', listener);
		}
		return requested;
	}

	it('asks for 100,000 rows at a time by default, and stops after a short chunk', async () => {
		expect(await requestedRows()).toStrictEqual([100_000]);
	});

	it('asks once more after a chunk that was exactly full, and stops on the empty one', async () => {
		expect(await requestedRows(5)).toStrictEqual([5, 5]);
	});

	it.each([0, -1, 1.5, Number.NaN])('rejects a chunk size of %s', async (chunkSize) => {
		await expect(scan(archive, chunkSize)).rejects.toThrow(RangeError);
	});

	it('stops reading and rejects when the callback fails', async () => {
		let calls = 0;
		await expect(
			scanAnchorEdges({
				knex: archive.getKnex(),
				chunkSize: 2,
				onChunk: () => {
					calls++;
					throw new Error('boom');
				},
			}),
		).rejects.toThrow('boom');
		expect(calls).toBe(1);
	});

	it('reads the next chunk only after an asynchronous callback finished with the previous one', async () => {
		const events: string[] = [];
		await scanAnchorEdges({
			knex: archive.getKnex(),
			chunkSize: 2,
			onChunk: async (rows) => {
				events.push(`start ${rows.length}`);
				await new Promise((resolve) => setTimeout(resolve, 20));
				events.push(`end ${rows.length}`);
			},
		});
		expect(events).toStrictEqual([
			'start 2',
			'end 2',
			'start 2',
			'end 2',
			'start 1',
			'end 1',
		]);
	});

	it('fails loudly when the driver does not return the rows as an array', async () => {
		// A query builder whose every call returns itself, and which resolves to a
		// result wrapper instead of an array of rows.
		const builder = {
			select: () => builder,
			whereRaw: () => builder,
			orderBy: () => builder,
			limit: () => builder,
			// eslint-disable-next-line unicorn/no-thenable
			then: (resolve: (value: unknown) => void) => {
				resolve({ rows: [] });
			},
		};
		await expect(
			scanAnchorEdges({ knex: (() => builder) as unknown as Knex, onChunk: () => {} }),
		).rejects.toThrow(TypeError);
	});

	it('does not call back for a table without edges', async () => {
		expect(await scan(emptyArchive, 2)).toStrictEqual([]);
	});

	it('maps each row to the page and the page it links to', async () => {
		const [{ pageId, hrefId }] = await scanEdges(archive, 100);
		const knex = archive.getKnex();
		const urlOf = async (id: number) => {
			const row = await knex('content_items as ci')
				.join('url_refs as ur', 'ur.id', 'ci.url_id')
				.where('ci.id', id)
				.first('ur.url as url');
			return row.url as string;
		};
		// The lowest edge is from the first page written to the first page it links to.
		expect([await urlOf(pageId), await urlOf(hrefId)]).toStrictEqual([
			'https://example.com/a',
			'https://example.com/b',
		]);
	});
});
