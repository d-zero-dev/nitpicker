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

describe('matchSelectorSnapshots with a signal', () => {
	/**
	 * Enough work that the abort, raised right after the call returns, lands
	 * while the batch is still being judged. That the scan then stops part way is the
	 * Rust tests' concern; here the abort must reach the call and read as the
	 * caller's own.
	 */
	function slowBatch() {
		const body = zstdCompressSync(Buffer.from(`<p>${'a'.repeat(100_000)}</p>`, 'utf8'));
		return Array.from({ length: 200 }, () => ({ body, codec: 'zstd' }));
	}

	it('rejects with the signal reason without judging when it is already aborted', async () => {
		const reason = new Error('aborted first');
		await expect(
			matchSelectorSnapshots({
				plan: IMG_PLAN,
				snapshots: [stored('<img>', 'none')],
				signal: AbortSignal.abort(reason),
			}),
		).rejects.toBe(reason);
	});

	it('rejects with the signal reason when it aborts right after the call', async () => {
		const controller = new AbortController();
		const reason = new Error('client went away');
		const outcome = matchSelectorSnapshots({
			plan: IMG_PLAN,
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
		const outcome = matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: [{ body, codec: 'zstd' }],
			signal: controller.signal,
		});
		controller.abort(reason);
		await expect(outcome).rejects.toBe(reason);
	});

	it('judges the same verdicts with a signal that never fires', async () => {
		const snapshots = [stored('<p><img></p>', 'zstd'), stored('<p>x</p>', 'none')];
		const verdicts = await matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots,
			signal: new AbortController().signal,
		});
		expect(verdicts.map((verdict) => verdict.matched)).toEqual([true, false]);
	});

	it('settles every call issued together, each with its own verdicts', async () => {
		const calls = Array.from({ length: 6 }, (_, index) =>
			matchSelectorSnapshots({
				plan: IMG_PLAN,
				snapshots: [stored(index % 2 === 0 ? '<img>' : '<p>x</p>', 'zstd')],
			}),
		);
		const results = await Promise.all(calls);
		expect(results.map(([verdict]) => verdict!.matched)).toEqual([
			true,
			false,
			true,
			false,
			true,
			false,
		]);
	});

	it('does not stop a call whose own signal is not the one that fired', async () => {
		const quiet = new AbortController();
		const noisy = new AbortController();
		const kept = matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: [stored('<img>', 'none')],
			signal: quiet.signal,
		});
		const stopped = matchSelectorSnapshots({
			plan: IMG_PLAN,
			snapshots: slowBatch(),
			signal: noisy.signal,
		});
		noisy.abort(new Error('only this one'));
		await expect(stopped).rejects.toThrow('only this one');
		const keptVerdicts = await kept;
		expect(keptVerdicts[0]!.matched).toBe(true);
	});
});
