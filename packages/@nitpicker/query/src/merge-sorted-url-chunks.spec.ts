import path from 'node:path';

import { pathComparator } from '@d-zero/shared/sort/path';
import { afterEach, describe, expect, it } from 'vitest';

import { mergeSortedUrlChunks } from './merge-sorted-url-chunks.js';
import { writeSortedUrlChunk } from './write-sorted-url-chunk.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_merge_sorted_url_chunks__');

describe('mergeSortedUrlChunks', () => {
	afterEach(async () => {
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('merges multiple sorted chunk files into one ascending stream', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		const allUrls = [
			'https://example.com/image-10.jpg',
			'https://example.com/image-2.jpg',
			'https://example.com/image-1.jpg',
			'https://example.com/about/',
			'https://b.example.com/',
		];
		// Split arbitrarily across three chunk files — the merge must still
		// produce the same global order as sorting everything at once.
		const chunkFiles = await Promise.all([
			writeSortedUrlChunk([allUrls[0]!, allUrls[3]!], workingDir, 0),
			writeSortedUrlChunk([allUrls[1]!], workingDir, 1),
			writeSortedUrlChunk([allUrls[2]!, allUrls[4]!], workingDir, 2),
		]);

		const merged: string[] = [];
		for await (const key of mergeSortedUrlChunks(chunkFiles)) {
			merged.push(key.original);
		}

		expect(merged).toEqual([...allUrls].toSorted(pathComparator));
	});

	it('collapses a URL present in more than one chunk to a single entry', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		const chunkFiles = await Promise.all([
			writeSortedUrlChunk(
				['https://example.com/dup', 'https://example.com/a'],
				workingDir,
				0,
			),
			writeSortedUrlChunk(
				['https://example.com/dup', 'https://example.com/b'],
				workingDir,
				1,
			),
		]);

		const merged: string[] = [];
		for await (const key of mergeSortedUrlChunks(chunkFiles)) {
			merged.push(key.original);
		}

		expect(merged).toEqual([
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/dup',
		]);
	});

	it('keeps two distinct URLs separate even when compareUrlSortKeys treats them as tied', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		// numericalComparator("007", "7") treats both basenames as the numeral
		// 7, so compareUrlSortKeys(a, b) === 0 for these two distinct URLs. If
		// dedup were keyed on that comparison result instead of `original`
		// string equality, one of these two pages would be silently dropped —
		// see mergeSortedUrlChunks' JSDoc on why dedup uses `original`.
		const chunkFiles = await Promise.all([
			writeSortedUrlChunk(['https://example.com/007'], workingDir, 0),
			writeSortedUrlChunk(['https://example.com/7'], workingDir, 1),
		]);

		const merged: string[] = [];
		for await (const key of mergeSortedUrlChunks(chunkFiles)) {
			merged.push(key.original);
		}

		expect(merged).toHaveLength(2);
		expect(merged).toEqual(
			expect.arrayContaining(['https://example.com/007', 'https://example.com/7']),
		);
	});

	it('returns nothing when all chunk files are empty', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		const chunkFiles = await Promise.all([
			writeSortedUrlChunk([], workingDir, 0),
			writeSortedUrlChunk([], workingDir, 1),
		]);

		const merged: string[] = [];
		for await (const key of mergeSortedUrlChunks(chunkFiles)) {
			merged.push(key.original);
		}

		expect(merged).toEqual([]);
	});
});
