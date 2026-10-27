import type { SelectorPlan } from './types.js';

import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect, vi } from 'vitest';

vi.mock('./max-decoded-snapshot-bytes.js', () => ({ MAX_DECODED_SNAPSHOT_BYTES: 1024 }));

const { matchSelectorSnapshots } = await import('./match-selector-snapshots.js');

const IMG_PLAN: SelectorPlan = {
	alternatives: [
		{
			compounds: [{ tag: 'img', attributes: [], nth: [], negations: [] }],
			combinators: [],
			prefilterLiterals: ['<img'],
			direct: true,
		},
	],
	needsChildIndex: false,
	needsTypeIndex: false,
};

/**
 * A document of `bytes` bytes that ends with an `img`.
 * @param bytes - The document's size.
 */
function documentOf(bytes: number): Buffer {
	return Buffer.from(`${'a'.repeat(bytes - 5)}<img>`, 'utf8');
}

describe('matchSelectorSnapshots with the limit on one decompressed snapshot', () => {
	it('judges a zstd snapshot that decompresses to exactly the limit', async () => {
		const [verdict] = await matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: [{ body: zstdCompressSync(documentOf(1024)), codec: 'zstd' }],
		});
		expect(verdict!.matched).toBe(true);
	});

	it('rejects the batch, naming the snapshot, when a zstd snapshot decompresses past the limit', async () => {
		await expect(
			matchSelectorSnapshots({
				plan: IMG_PLAN,
				snapshots: [
					{ body: Buffer.from('<img>'), codec: 'none' },
					{ body: zstdCompressSync(documentOf(1025)), codec: 'zstd' },
				],
			}),
		).rejects.toThrow(/^snapshot 1 could not be decoded: .*more than 1024 bytes/);
	});

	it('judges a snapshot stored as it is whatever its size', async () => {
		const [verdict] = await matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: [{ body: documentOf(4096), codec: 'none' }],
		});
		expect(verdict!.matched).toBe(true);
	});
});
