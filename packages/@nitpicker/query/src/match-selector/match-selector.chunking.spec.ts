import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

import { matchSelector } from './match-selector.js';

// Shrinking both chunk sizes at the module boundary makes five snapshots
// span three scan chunks and the page lookups span several `IN (...)`
// batches, without touching the production code.
vi.mock('./scan-chunk.js', () => ({ SCAN_CHUNK: 2 }));
vi.mock('../sqlite-in-chunk.js', () => ({ SQLITE_IN_CHUNK: 2 }));

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_match_selector_chunking__',
);

describe('matchSelector across chunks', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'chunking.nitpicker',
			// five distinct snapshots; /4 repeats the snapshot of /1
			pages: [
				{ url: 'https://example.com/1', html: '<p class="c1">1</p>' },
				{ url: 'https://example.com/2', html: '<p class="c2">2</p>' },
				{ url: 'https://example.com/3', html: '<p class="c3">3</p>' },
				{ url: 'https://example.com/4', html: '<p class="c1">1</p>' },
				{ url: 'https://example.com/5', html: '<p class="c5">5</p>' },
				{ url: 'https://example.com/6', html: '<p class="c6">6</p>' },
			],
		});
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('scans every snapshot exactly once and reports each chunk', async () => {
		const messages: string[] = [];
		const result = await matchSelector(archive, {
			selector: 'p',
			onProgress: (message) => messages.push(message),
		});

		expect(result).toMatchObject({
			total: 6,
			scannedSnapshots: 5,
			matchedSnapshots: 5,
			candidatePages: 6,
		});
		expect(messages).toEqual([
			'Scanning HTML snapshots: 2 / 5',
			'Scanning HTML snapshots: 4 / 5',
			'Scanning HTML snapshots: 5 / 5',
		]);
	});

	it('does not drop a match at a chunk boundary and fans out to every page of a snapshot', async () => {
		const result = await matchSelector(archive, { selector: 'p.c1, p.c3, p.c6' });

		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/1',
			'https://example.com/3',
			'https://example.com/4',
			'https://example.com/6',
		]);
		expect(result).toMatchObject({ total: 4, matchedSnapshots: 3 });
	});

	it('resolves the URLs of a slice larger than one lookup batch', async () => {
		const result = await matchSelector(archive, { selector: 'p', limit: 5, offset: 1 });

		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/2',
			'https://example.com/3',
			'https://example.com/4',
			'https://example.com/5',
			'https://example.com/6',
		]);
	});
});
