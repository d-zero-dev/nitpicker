import type { StoredSnapshotBlob } from './types.js';

import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

import { estimateDecodedBytes } from './estimate-decoded-bytes.js';
import { scanHtmlSnapshots } from './scan-html-snapshots.js';

// Two snapshots per read chunk. The batch budget starts so small that every
// snapshot closes its own batch (five snapshots, three chunks of 2 + 2 + 1
// reads, five judged batches); a spec can change it through `budget`.
const budget = vi.hoisted(() => ({ bytes: 1 }));
const chunk = vi.hoisted(() => ({ size: 2 }));
vi.mock('./scan-chunk.js', () => ({
	get SCAN_CHUNK() {
		return chunk.size;
	},
}));
vi.mock('./scan-batch-bytes.js', () => ({
	get SCAN_BATCH_BYTES() {
		return budget.bytes;
	},
}));
vi.mock('../sqlite-in-chunk.js', () => ({ SQLITE_IN_CHUNK: 2 }));

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_scan_html_snapshots_batch__',
);

/**
 * The HTML of a stored snapshot.
 * @param blob - The stored snapshot as handed to the judge.
 */
function htmlOf(blob: StoredSnapshotBlob): string {
	const bytes = Buffer.from(blob.body);
	return (blob.codec === 'zstd' ? zstdDecompressSync(bytes) : bytes).toString('utf8');
}

describe('scanHtmlSnapshots with a batch judge', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'scan-batch.nitpicker',
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

	it('hands every distinct snapshot to the judge once, still encoded, in budget-closed batches', async () => {
		const batches: string[][] = [];
		const messages: string[] = [];
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			judgeBatch: (batch) => {
				batches.push(batch.map((blob) => htmlOf(blob)));
				return Promise.resolve(batch.map(() => false));
			},
			onProgress: (message) => messages.push(message),
		});

		expect(batches.every((batch) => batch.length === 1)).toBe(true);
		expect(batches.flat().toSorted()).toEqual([
			'<p>1</p>',
			'<p>2</p>',
			'<p>3</p>',
			'<p>5</p>',
			'<p>6</p>',
		]);
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

	it('fans a snapshot the judge accepts out to every page sharing it, in page-id order', async () => {
		const wanted = new Set(['<p>1</p>', '<p>3</p>', '<p>6</p>']);
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			judgeBatch: (batch) =>
				Promise.resolve(batch.map((blob) => wanted.has(htmlOf(blob)))),
		});

		const urlById = new Map(
			(
				(await archive
					.getKnex()('content_items as ci')
					.join('url_refs as ur', 'ur.id', 'ci.url_id')
					.select('ci.id as id', 'ur.url as url')) as { id: number; url: string }[]
			).map((row) => [row.id, row.url]),
		);
		expect(result.matchedPages.map((page) => urlById.get(page.pageId))).toEqual([
			'https://example.com/1',
			'https://example.com/dir/3',
			'https://example.com/4',
			'https://example.com/dir/6',
		]);
		expect(result.matchedSnapshots).toBe(3);
	});

	it('pairs each verdict with the snapshot it was given, not with the hash asked for', async () => {
		// The verdict follows the content, so a mix-up of which row belongs to which
		// hash would fan the match out to the wrong pages.
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			judgeBatch: (batch) =>
				Promise.resolve(batch.map((blob) => htmlOf(blob) === '<p>5</p>')),
		});
		const hashes = new Set(result.matchedPages.map((page) => page.hash));
		expect(hashes.size).toBe(1);
		expect(result.matchedPages).toHaveLength(1);
	});

	it('judges a snapshot that alone exceeds the budget in a batch of its own', async () => {
		const sizes: number[] = [];
		await scanHtmlSnapshots({
			knex: archive.getKnex(),
			judgeBatch: (batch) => {
				sizes.push(batch.length);
				return Promise.resolve(batch.map(() => false));
			},
		});
		expect(sizes).toEqual([1, 1, 1, 1, 1]);
	});

	it('keeps the snapshots of a chunk together while they fit the budget, and judges the remainder', async () => {
		budget.bytes = 1_000_000;
		try {
			const sizes: number[] = [];
			const result = await scanHtmlSnapshots({
				knex: archive.getKnex(),
				judgeBatch: (batch) => {
					sizes.push(batch.length);
					return Promise.resolve(batch.map(() => true));
				},
			});
			// Chunks of 2 + 2 + 1: nothing reaches the budget, so each chunk's rows end
			// as one batch (the remainder), and no snapshot is dropped.
			expect(sizes).toEqual([2, 2, 1]);
			expect(result.matchedSnapshots).toBe(5);
		} finally {
			budget.bytes = 1;
		}
	});

	it('closes a batch when its estimated size reaches the budget, not before', async () => {
		const estimates: number[] = [];
		await scanHtmlSnapshots({
			knex: archive.getKnex(),
			judgeBatch: (batch) => {
				estimates.push(...batch.map((blob) => estimateDecodedBytes(blob)));
				return Promise.resolve(batch.map(() => false));
			},
		});
		// Same walk, all five snapshots in one chunk, with a budget of exactly the
		// first two: the batch closes at the sum (`>=`), so it holds those two and
		// not a third.
		budget.bytes = estimates[0]! + estimates[1]!;
		chunk.size = 5;
		try {
			const batches: number[][] = [];
			await scanHtmlSnapshots({
				knex: archive.getKnex(),
				judgeBatch: (batch) => {
					batches.push(batch.map((blob) => estimateDecodedBytes(blob)));
					return Promise.resolve(batch.map(() => false));
				},
			});
			expect(batches[0]).toEqual([estimates[0], estimates[1]]);
			expect(batches.flat()).toHaveLength(5);
		} finally {
			budget.bytes = 1;
			chunk.size = 2;
		}
	});

	it('reads the next chunk while the batch judge is still working on the current one', async () => {
		const knex = archive.getKnex();
		let blobReads = 0;
		const onQuery = (query: { sql: string }) => {
			if (query.sql.includes('page_html_blobs')) {
				blobReads++;
			}
		};
		knex.on('query', onQuery);
		const readsWhenJudging: number[] = [];
		try {
			await scanHtmlSnapshots({
				knex,
				judgeBatch: async (batch) => {
					// Let the already-started read of the next chunk go through.
					await new Promise((resolve) => setTimeout(resolve, 100));
					readsWhenJudging.push(blobReads);
					return batch.map(() => false);
				},
			});
		} finally {
			knex.removeListener('query', onQuery);
		}
		// Chunks of 2 + 2 + 1, each batch of one: while the first batch is judged, the
		// second chunk has been requested already.
		expect(readsWhenJudging[0]).toBeGreaterThanOrEqual(2);
		expect(blobReads).toBe(3);
	});

	it('does not read ahead for a judge that runs on this thread', async () => {
		const knex = archive.getKnex();
		let blobReads = 0;
		const onQuery = (query: { sql: string }) => {
			if (query.sql.includes('page_html_blobs')) {
				blobReads++;
			}
		};
		knex.on('query', onQuery);
		const readsWhenJudging: number[] = [];
		try {
			await scanHtmlSnapshots({
				knex,
				matches: () => {
					readsWhenJudging.push(blobReads);
					return false;
				},
			});
		} finally {
			knex.removeListener('query', onQuery);
		}
		expect(readsWhenJudging[0]).toBe(1);
	});

	it('names the hash of the snapshot the judge could not decode', async () => {
		const hashes: string[] = [];
		await scanHtmlSnapshots({
			knex: archive.getKnex(),
			matches: ({ hash }) => {
				hashes.push(hash);
				return false;
			},
		});
		const error = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			judgeBatch: () => Promise.reject(new Error('snapshot 0 could not be decoded: bad')),
		}).catch((error_: unknown) => error_ as Error);
		expect(error.message).toContain('snapshot 0 could not be decoded: bad');
		expect(hashes.some((hash) => error.message.includes(hash))).toBe(true);
	});

	it('fails the scan when the judge returns the wrong number of verdicts', async () => {
		await expect(
			scanHtmlSnapshots({
				knex: archive.getKnex(),
				judgeBatch: () => Promise.resolve([]),
			}),
		).rejects.toThrow('returned 0 verdicts for 1 snapshots');
	});

	it('passes a rejection of the judge through', async () => {
		await expect(
			scanHtmlSnapshots({
				knex: archive.getKnex(),
				judgeBatch: () => Promise.reject(new Error('snapshot 0 could not be decoded')),
			}),
		).rejects.toThrow('could not be decoded');
	});

	it('reports nothing and never calls the judge when no page is searchable', async () => {
		const judgeBatch = vi.fn(() => Promise.resolve([] as boolean[]));
		const messages: string[] = [];
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			filters: { urlPattern: '%/no-such-page' },
			judgeBatch,
			onProgress: (message) => messages.push(message),
		});
		expect(judgeBatch).not.toHaveBeenCalled();
		expect(messages).toEqual([]);
		expect(result.scannedSnapshots).toBe(0);
	});
});
