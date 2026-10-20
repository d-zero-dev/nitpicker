import type { SelectorPlan } from './types.js';

import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { matchSelectorSnapshots } from './match-selector-snapshots.js';

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
 * A stored snapshot.
 * @param html - The HTML.
 * @param codec - How to store it.
 */
function stored(html: string, codec: 'zstd' | 'none') {
	const bytes = Buffer.from(html, 'utf8');
	return { body: codec === 'zstd' ? zstdCompressSync(bytes) : bytes, codec };
}

describe('matchSelectorSnapshots', () => {
	it('judges plain and compressed snapshots, one verdict each in input order', async () => {
		const verdicts = await matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: [
				stored('<p><img></p>', 'zstd'),
				stored('<p>x</p>', 'none'),
				stored('<img>', 'none'),
				stored('<p>y</p>', 'zstd'),
			],
		});
		expect(verdicts).toEqual([
			{ matched: true, prefiltered: false, tokenized: false },
			{ matched: false, prefiltered: true, tokenized: false },
			{ matched: true, prefiltered: false, tokenized: false },
			{ matched: false, prefiltered: true, tokenized: false },
		]);
	});

	it('reports the stack for a snapshot with a template', async () => {
		const [verdict] = await matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: [stored('<template><img></template>', 'zstd')],
		});
		expect(verdict).toEqual({ matched: false, prefiltered: false, tokenized: true });
	});

	it('returns nothing for an empty batch', async () => {
		await expect(
			matchSelectorSnapshots({ plan: IMG_PLAN, snapshots: [] }),
		).resolves.toEqual([]);
	});

	it('reads invalid UTF-8 as replacement characters instead of failing', async () => {
		const body = Buffer.concat([
			Buffer.from('<p title="'),
			Buffer.from([255, 254]),
			Buffer.from('"><img>'),
		]);
		const [verdict] = await matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: [{ body, codec: 'none' }],
		});
		expect(verdict!.matched).toBe(true);
	});

	it('rejects the whole batch when a snapshot is not valid zstd', async () => {
		await expect(
			matchSelectorSnapshots({
				plan: IMG_PLAN,
				snapshots: [
					stored('<img>', 'none'),
					{ body: Buffer.from('not zstd'), codec: 'zstd' },
				],
			}),
		).rejects.toThrow(/snapshot 1 could not be decoded/);
	});

	it('throws for a codec it does not know', async () => {
		await expect(
			matchSelectorSnapshots({
				plan: IMG_PLAN,
				snapshots: [{ body: Buffer.from('<img>'), codec: 'brotli' }],
			}),
		).rejects.toThrow('Unknown page_html_blobs.codec: brotli');
	});

	it('rejects with InvalidArg for a malformed plan', async () => {
		const badPlan: SelectorPlan = {
			...IMG_PLAN,
			alternatives: [{ ...IMG_PLAN.alternatives[0]!, combinators: ['child'] }],
		};
		await expect(
			matchSelectorSnapshots({ plan: badPlan, snapshots: [stored('<img>', 'none')] }),
		).rejects.toMatchObject({ code: 'InvalidArg' });
	});

	it('judges a batch of many documents', async () => {
		const snapshots = Array.from({ length: 300 }, (_, index) =>
			stored(index % 3 === 0 ? '<img>' : '<p>x</p>', index % 2 === 0 ? 'zstd' : 'none'),
		);
		const verdicts = await matchSelectorSnapshots({ plan: IMG_PLAN, snapshots });
		expect(verdicts.filter((verdict) => verdict.matched)).toHaveLength(100);
		expect(verdicts.map((verdict) => verdict.matched)).toEqual(
			snapshots.map((_, index) => index % 3 === 0),
		);
	});
});
