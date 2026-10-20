import type { SelectorPlan } from './types.js';

import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { matchSelectorSnapshots } from './match-selector-snapshots.js';

const IMG: SelectorPlan = {
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

describe('matchSelectorSnapshots', () => {
	it('judges stored snapshots of both codecs, one verdict each in input order', async () => {
		const verdicts = await matchSelectorSnapshots({
			plan: IMG,
			snapshots: [
				{ body: zstdCompressSync(Buffer.from('<p><img></p>')), codec: 'zstd' },
				{ body: Buffer.from('<p>x</p>'), codec: 'none' },
			],
		});
		expect(verdicts).toEqual([
			{ matched: true, prefiltered: false, tokenized: false },
			{ matched: false, prefiltered: true, tokenized: false },
		]);
	});

	it('rejects a snapshot that is not valid zstd instead of judging it no match', async () => {
		await expect(
			matchSelectorSnapshots({
				plan: IMG,
				snapshots: [{ body: Buffer.from('not zstd'), codec: 'zstd' }],
			}),
		).rejects.toThrow(/could not be decoded/);
	});

	it('rejects a codec it does not know', async () => {
		await expect(
			matchSelectorSnapshots({
				plan: IMG,
				snapshots: [{ body: Buffer.from('<img>'), codec: 'lz4' }],
			}),
		).rejects.toThrow('Unknown page_html_blobs.codec: lz4');
	});
});
