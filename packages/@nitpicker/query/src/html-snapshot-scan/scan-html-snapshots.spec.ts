import type { HtmlSnapshot } from './types.js';

import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

import { scanHtmlSnapshots } from './scan-html-snapshots.js';

// Shrinking both chunk sizes at the module boundary makes five snapshots
// span three scan chunks and the page lookups span several `IN (...)`
// batches, without touching the production code.
vi.mock('./scan-chunk.js', () => ({ SCAN_CHUNK: 2 }));
vi.mock('../sqlite-in-chunk.js', () => ({ SQLITE_IN_CHUNK: 2 }));

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_scan_html_snapshots__',
);

// Lowercase hex SHA-256 of the stored HTML, the key a snapshot is reported by.
const HASH_1 = '16de9dfa12664d7331c84ac261051ef5ebe566d03dae3faf5e45825fb04bcdbc';
const HASH_3 = 'bf0ad876db9d08db1bf278c0f79b107ac010116a89e0bcfb8e58451953e42c70';
const HASH_6 = '4609c0e45cf890494a7db8e8cac31c2bc2451f6a69f5951ed3a3ecd31582efae';

describe('scanHtmlSnapshots', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'scan.nitpicker',
			// five distinct searchable snapshots; /4 repeats the snapshot of /1
			pages: [
				{ url: 'https://example.com/1', html: '<p>1</p>' },
				{ url: 'https://example.com/2', html: '<p>2</p>' },
				{ url: 'https://example.com/dir/3', html: '<p>3</p>' },
				{ url: 'https://example.com/4', html: '<p>1</p>' },
				{ url: 'https://example.com/5', html: '<p>5</p>' },
				{ url: 'https://example.com/dir/6', html: '<p>6</p>' },
				{ url: 'https://example.com/doc.pdf', html: '', contentType: 'application/pdf' },
				{ url: 'https://example.com/excluded', html: '<p>x</p>', isSkipped: true },
			],
		});
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('judges each distinct snapshot once and reports progress per chunk', async () => {
		const judged: HtmlSnapshot[] = [];
		const messages: string[] = [];
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			matches: (snapshot) => {
				judged.push(snapshot);
				return false;
			},
			onProgress: (message) => messages.push(message),
		});

		expect(judged.map((snapshot) => snapshot.html).toSorted()).toEqual([
			'<p>1</p>',
			'<p>2</p>',
			'<p>3</p>',
			'<p>5</p>',
			'<p>6</p>',
		]);
		expect(judged.find((snapshot) => snapshot.html === '<p>1</p>')?.hash).toBe(HASH_1);
		expect(messages).toEqual([
			'Scanning HTML snapshots: 2 / 5',
			'Scanning HTML snapshots: 4 / 5',
			'Scanning HTML snapshots: 5 / 5',
		]);
		expect(result).toEqual({
			matchedPages: [],
			matchedSnapshots: 0,
			scannedSnapshots: 5,
			candidatePages: 6,
		});
	});

	it('fans a matched snapshot out to every page sharing it, in page-id order', async () => {
		const wanted = new Set(['<p>1</p>', '<p>3</p>', '<p>6</p>']);
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			matches: ({ html }) => wanted.has(html),
		});

		const urlById = new Map(
			(
				(await archive
					.getKnex()('content_items as ci')
					.join('url_refs as ur', 'ur.id', 'ci.url_id')
					.select('ci.id as id', 'ur.url as url')) as { id: number; url: string }[]
			).map((row) => [row.id, row.url]),
		);
		expect(
			result.matchedPages.map((page) => [urlById.get(page.pageId), page.hash]),
		).toEqual([
			['https://example.com/1', HASH_1],
			['https://example.com/dir/3', HASH_3],
			['https://example.com/4', HASH_1],
			['https://example.com/dir/6', HASH_6],
		]);
		expect(result.matchedSnapshots).toBe(3);
	});

	it('scans and counts only the pages the filters keep', async () => {
		const messages: string[] = [];
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			filters: { directory: '/dir' },
			matches: () => true,
			onProgress: (message) => messages.push(message),
		});

		expect(result).toMatchObject({
			matchedSnapshots: 2,
			scannedSnapshots: 2,
			candidatePages: 2,
		});
		expect(result.matchedPages).toHaveLength(2);
		expect(messages).toEqual(['Scanning HTML snapshots: 2 / 2']);
	});

	it('reports nothing when no page is searchable', async () => {
		const messages: string[] = [];
		const matches = vi.fn(() => true);
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			filters: { urlPattern: '%/no-such-page' },
			matches,
			onProgress: (message) => messages.push(message),
		});

		expect(matches).not.toHaveBeenCalled();
		expect(messages).toEqual([]);
		expect(result).toEqual({
			matchedPages: [],
			matchedSnapshots: 0,
			scannedSnapshots: 0,
			candidatePages: 0,
		});
	});
});
