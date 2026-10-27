import type { NativeSearchPattern } from './types.js';

import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect, vi } from 'vitest';

vi.mock('./max-decoded-snapshot-bytes.js', () => ({ MAX_DECODED_SNAPSHOT_BYTES: 1024 }));

const { searchHtmlSnapshots } = await import('./search-html-snapshots.js');

const NEEDLE: NativeSearchPattern = {
	source: 'needle',
	literal: true,
	ignoreCase: false,
	multiLine: false,
	dotAll: false,
};

/**
 * A document of `bytes` bytes that ends with `needle`.
 * @param bytes - The document's size.
 */
function documentOf(bytes: number): Buffer {
	return Buffer.from(`${'a'.repeat(bytes - 6)}needle`, 'utf8');
}

describe('searchHtmlSnapshots with the limit on one decompressed snapshot', () => {
	it('searches a zstd snapshot that decompresses to exactly the limit', async () => {
		const [outcome] = await searchHtmlSnapshots({
			pattern: NEEDLE,
			snippetLength: 10,
			snapshots: [{ body: zstdCompressSync(documentOf(1024)), codec: 'zstd' }],
		});
		expect(outcome!.matchCount).toBe(1);
	});

	it('rejects the batch, naming the snapshot, when a zstd snapshot decompresses past the limit', async () => {
		await expect(
			searchHtmlSnapshots({
				pattern: NEEDLE,
				snippetLength: 10,
				snapshots: [
					{ body: Buffer.from('needle'), codec: 'none' },
					{ body: zstdCompressSync(documentOf(1025)), codec: 'zstd' },
				],
			}),
		).rejects.toThrow(/^snapshot 1 could not be decoded: .*more than 1024 bytes/);
	});

	it('searches a snapshot stored as it is whatever its size', async () => {
		const [outcome] = await searchHtmlSnapshots({
			pattern: NEEDLE,
			snippetLength: 10,
			snapshots: [{ body: documentOf(4096), codec: 'none' }],
		});
		expect(outcome!.matchCount).toBe(1);
	});
});
