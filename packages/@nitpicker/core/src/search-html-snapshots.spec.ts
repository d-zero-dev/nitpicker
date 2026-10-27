import type { NativeSearchPattern } from './types.js';

import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { MAX_DECODED_SNAPSHOT_BYTES } from './max-decoded-snapshot-bytes.js';
import { nativeBinding } from './native-binding.js';
import { searchHtmlSnapshots } from './search-html-snapshots.js';

/**
 * A literal pattern.
 * @param source - The text to find.
 */
function literal(source: string): NativeSearchPattern {
	return { source, literal: true, ignoreCase: false, multiLine: false, dotAll: false };
}

/**
 * A stored snapshot.
 * @param html - The HTML.
 * @param codec - How to store it.
 */
function stored(html: string, codec: 'zstd' | 'none') {
	const bytes = Buffer.from(html, 'utf8');
	return { body: codec === 'zstd' ? zstdCompressSync(bytes) : bytes, codec };
}

describe('searchHtmlSnapshots', () => {
	it('searches plain and compressed snapshots, one outcome each in input order', async () => {
		const outcomes = await searchHtmlSnapshots({
			pattern: literal('needle'),
			snippetLength: 20,
			snapshots: [
				stored('<p>needle needle</p>', 'zstd'),
				stored('<p>x</p>', 'none'),
				stored('needle', 'none'),
				stored('<p>y</p>', 'zstd'),
			],
		});
		expect(outcomes).toEqual([
			{ matchCount: 2, snippet: '<p>needle needle</p>' },
			{ matchCount: 0, snippet: '' },
			{ matchCount: 1, snippet: 'needle' },
			{ matchCount: 0, snippet: '' },
		]);
	});

	it('returns nothing for an empty batch', async () => {
		await expect(
			searchHtmlSnapshots({ pattern: literal('x'), snippetLength: 20, snapshots: [] }),
		).resolves.toEqual([]);
	});

	it('rejects the whole batch when a snapshot is not valid zstd', async () => {
		await expect(
			searchHtmlSnapshots({
				pattern: literal('x'),
				snippetLength: 20,
				snapshots: [
					stored('x', 'none'),
					{ body: Buffer.from('not zstd'), codec: 'zstd' },
				],
			}),
		).rejects.toThrow(/snapshot 1 could not be decoded/);
	});

	it('throws for a codec it does not know', async () => {
		await expect(
			searchHtmlSnapshots({
				pattern: literal('x'),
				snippetLength: 20,
				snapshots: [{ body: Buffer.from('x'), codec: 'brotli' }],
			}),
		).rejects.toThrow('Unknown page_html_blobs.codec: brotli');
	});

	it('rejects with InvalidArg for a pattern the engine cannot compile', async () => {
		await expect(
			searchHtmlSnapshots({
				pattern: { ...literal('(?=a)a'), literal: false },
				snippetLength: 20,
				snapshots: [stored('a', 'none')],
			}),
		).rejects.toMatchObject({ code: 'InvalidArg' });
	});

	it('searches a batch of many documents', async () => {
		// Six documents, repeated: hit, miss, miss, hit, miss, miss; codecs alternate.
		const pattern = [
			['a needle b', 'zstd'],
			['<p>x</p>', 'none'],
			['<p>x</p>', 'zstd'],
			['a needle b', 'none'],
			['<p>x</p>', 'zstd'],
			['<p>x</p>', 'none'],
		] as const;
		const snapshots = Array.from({ length: 300 }, (_, index) => {
			const [html, codec] = pattern[index % pattern.length]!;
			return stored(html, codec);
		});
		const outcomes = await searchHtmlSnapshots({
			pattern: literal('needle'),
			snippetLength: 20,
			snapshots,
		});
		expect(outcomes.slice(0, 6).map((outcome) => outcome.matchCount)).toEqual([
			1, 0, 0, 1, 0, 0,
		]);
		expect(outcomes).toHaveLength(300);
		expect(outcomes.filter((outcome) => outcome.matchCount > 0)).toHaveLength(100);
	});

	it('searches again with the same pattern text but other flags, not with the previous compile', async () => {
		const snapshots = [stored('ABC', 'none')];
		const base = { source: 'abc', literal: false, multiLine: false, dotAll: false };
		const sensitive = await searchHtmlSnapshots({
			pattern: { ...base, ignoreCase: false },
			snippetLength: 20,
			snapshots,
		});
		const insensitive = await searchHtmlSnapshots({
			pattern: { ...base, ignoreCase: true },
			snippetLength: 20,
			snapshots,
		});
		const sensitiveAgain = await searchHtmlSnapshots({
			pattern: { ...base, ignoreCase: false },
			snippetLength: 20,
			snapshots,
		});
		expect(sensitive[0]!.matchCount).toBe(0);
		expect(insensitive[0]!.matchCount).toBe(1);
		expect(sensitiveAgain[0]!.matchCount).toBe(0);
	});

	it('rejects a batch whose codec bytes or count the native call cannot take', () => {
		const call = (codecs: Uint8Array) =>
			nativeBinding.searchHtmlSnapshots(
				literal('x'),
				20,
				Uint8Array.of(120, 120),
				Uint32Array.of(0, 1, 2),
				codecs,
				MAX_DECODED_SNAPSHOT_BYTES,
			);
		expect(() => call(Uint8Array.of(0))).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
		expect(() => call(Uint8Array.of(0, 7))).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
	});
});

describe('searchHtmlSnapshots with a signal', () => {
	/**
	 * Enough work that the abort, raised right after the call returns, lands
	 * while the batch is still unsearched. That the scan then stops part way is the
	 * Rust tests' concern; here the abort must reach the call and read as the
	 * caller's own.
	 */
	function slowBatch() {
		const body = zstdCompressSync(Buffer.from(`<p>${'a'.repeat(100_000)}</p>`, 'utf8'));
		return Array.from({ length: 200 }, () => ({ body, codec: 'zstd' }));
	}

	it('rejects with the signal reason without searching when it is already aborted', async () => {
		const reason = new Error('aborted first');
		await expect(
			searchHtmlSnapshots({
				pattern: literal('needle'),
				snippetLength: 20,
				snapshots: [stored('needle', 'none')],
				signal: AbortSignal.abort(reason),
			}),
		).rejects.toBe(reason);
	});

	it('rejects with the signal reason when it aborts right after the call', async () => {
		const controller = new AbortController();
		const reason = new Error('client went away');
		const outcome = searchHtmlSnapshots({
			pattern: literal('needle'),
			snippetLength: 20,
			snapshots: slowBatch(),
			signal: controller.signal,
		});
		controller.abort(reason);
		await expect(outcome).rejects.toBe(reason);
	});

	it('rejects with the signal reason when it aborts right after a call holding one large snapshot', async () => {
		// One frame that decompresses to 64 MiB from a few kilobytes, and nothing
		// after it: when the native thread has already passed the check before
		// that snapshot, only a check inside its decompression sees the abort.
		// Which check sees it depends on timing, so this does not tell every run
		// whether the decompression checks at all; that it checks between steps
		// is the Rust tests' concern.
		const body = zstdCompressSync(Buffer.alloc(64 * 1024 * 1024, 'a'));
		const controller = new AbortController();
		const reason = new Error('client went away');
		const outcome = searchHtmlSnapshots({
			pattern: literal('needle'),
			snippetLength: 20,
			snapshots: [{ body, codec: 'zstd' }],
			signal: controller.signal,
		});
		controller.abort(reason);
		await expect(outcome).rejects.toBe(reason);
	});

	it('finds the same matches with a signal that never fires', async () => {
		const outcomes = await searchHtmlSnapshots({
			pattern: literal('needle'),
			snippetLength: 20,
			snapshots: [stored('needle', 'zstd'), stored('<p>x</p>', 'none')],
			signal: new AbortController().signal,
		});
		expect(outcomes.map((outcome) => outcome.matchCount)).toEqual([1, 0]);
	});

	it('settles every call issued together, each with its own matches', async () => {
		const calls = Array.from({ length: 6 }, (_, index) =>
			searchHtmlSnapshots({
				pattern: literal('needle'),
				snippetLength: 20,
				snapshots: [stored(index % 2 === 0 ? 'needle' : 'hay', 'zstd')],
			}),
		);
		const results = await Promise.all(calls);
		expect(results.map(([outcome]) => outcome!.matchCount)).toEqual([1, 0, 1, 0, 1, 0]);
	});
});
