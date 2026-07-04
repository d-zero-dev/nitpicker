import path from 'node:path';

import { pathComparator } from '@d-zero/shared/sort/path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeSortedUrlChunk } from './write-sorted-url-chunk.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_write_sorted_url_chunk__');

describe('writeSortedUrlChunk', () => {
	afterEach(async () => {
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('writes URLs to a JSON-Lines file, sorted in natural URL order', async () => {
		const { mkdirSync, readFileSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		const urls = [
			'https://example.com/image-10.jpg',
			'https://example.com/image-2.jpg',
			'https://example.com/image-1.jpg',
		];
		const filePath = await writeSortedUrlChunk(urls, workingDir, 0);

		const lines = readFileSync(filePath, 'utf8').trim().split('\n');
		const written = lines.map(
			(line) => (JSON.parse(line) as { original: string }).original,
		);

		expect(written).toEqual([...urls].toSorted(pathComparator));
	});

	it('keeps URLs that fail to parse as a fallback row instead of dropping them', async () => {
		const { mkdirSync, readFileSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		// A dropped row would leave that page/resource with no
		// `viewer_url_sort_keys` entry at all, which — per `orderByUrlRank`'s
		// scalar-subquery `ORDER BY` — sorts its NULL rank ahead of every
		// real one, bunching unparsable URLs at the top of every URL-sorted
		// view instead of just landing somewhere (anywhere) in the output.
		const filePath = await writeSortedUrlChunk(
			['not a url', 'https://example.com/'],
			workingDir,
			0,
		);

		const lines = readFileSync(filePath, 'utf8').trim().split('\n');
		const written = lines.map(
			(line) => (JSON.parse(line) as { original: string }).original,
		);
		expect(written).toEqual(['not a url', 'https://example.com/']);
	});

	it('writes an empty file for an empty input', async () => {
		const { mkdirSync, readFileSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		const filePath = await writeSortedUrlChunk([], workingDir, 0);
		expect(readFileSync(filePath, 'utf8')).toBe('');
	});
});
