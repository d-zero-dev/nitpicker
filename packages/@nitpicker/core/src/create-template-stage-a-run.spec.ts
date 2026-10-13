import type { StageAOutput, StageAPage, StageAProgress } from './types.js';

import { describe, it, expect } from 'vitest';

import { createTemplateStageARun } from './create-template-stage-a-run.js';

const LIST = '<body><main><ul><li><a>x</a></li><li><a>y</a></li></ul></main></body>';
const DETAIL =
	'<body><main><article><h1>t</h1><p>p</p><figure><img></figure></article></main></body>';

/**
 * Runs a whole in-memory or streaming classification of `pages`, all in one
 * block.
 * @param pages
 * @param streaming
 */
async function classify(
	pages: readonly StageAPage[],
	streaming: boolean,
): Promise<{ output: StageAOutput; events: StageAProgress[] }> {
	const events: StageAProgress[] = [];
	const run = createTemplateStageARun({
		blockKeys: ['path:news'],
		blockOfPage: new Uint32Array(pages.length),
		streaming,
		onProgress: (event) => events.push(event),
	});
	await run.pushPages(pages);
	await run.finishPages();
	if (run.needsAssignment()) {
		await run.pushAssignmentPages(pages);
	}
	return { output: await run.takeOutput(), events };
}

/**
 * Each page's cluster key.
 * @param output
 */
function keysOf(output: StageAOutput): string[] {
	return Array.from(output.keyOfPage, (key) => output.keys[key]!);
}

describe('createTemplateStageARun', () => {
	it('splits a block holding two templates into two clusters', async () => {
		const { output } = await classify(
			[LIST, LIST, DETAIL, DETAIL].map((html) => ({ html })),
			false,
		);
		expect(keysOf(output)).toEqual([
			'["path:news","cluster:0"]',
			'["path:news","cluster:0"]',
			'["path:news","cluster:1"]',
			'["path:news","cluster:1"]',
		]);
	});

	it('hands each cluster to Stage B with its members, token sets and landmarks', async () => {
		const withNav = '<body><nav><a>n</a></nav><main><p>x</p></main></body>';
		const { output } = await classify([{ html: withNav }, { html: withNav }], false);
		expect(output.units).toHaveLength(1);
		const [unit] = output.units;
		expect(output.keys[unit!.key]).toBe('["path:news","cluster:0"]');
		expect(unit!.block).toBe(0);
		expect([...unit!.memberPageIndices]).toEqual([0, 1]);
		const tokensOf = (from: number, to: number) =>
			[...unit!.memberTokens.subarray(from, to)].map((token) => output.tokens[token]);
		expect(tokensOf(unit!.memberTokenOffsets[0]!, unit!.memberTokenOffsets[1]!)).toEqual([
			'body>main>p',
		]);
		// One `nav` instance per member, tokenized on its own.
		expect([...unit!.memberInstanceOffsets]).toEqual([0, 1, 2]);
		expect([...unit!.instanceTypes]).toEqual([2, 2]);
		expect(
			[...unit!.instanceTokens.subarray(0, unit!.instanceTokenOffsets[1])].map(
				(token) => output.tokens[token],
			),
		).toEqual(['body>nav>a']);
	});

	it('reports each block as it completes', async () => {
		const { events } = await classify([{ html: LIST }], false);
		expect(events).toEqual([
			{
				phase: 'pass1-block-complete',
				blockKey: 'path:news',
				blocksProcessed: 1,
				totalBlocks: 1,
			},
		]);
	});

	it('clusters a sample per block when streaming and assigns the other pages', async () => {
		// 150 pages in one block: 100 are sampled, 50 assigned afterwards.
		const pages = Array.from({ length: 150 }, (_, index) => ({
			html: index % 2 === 0 ? LIST : DETAIL,
		}));
		const { output, events } = await classify(pages, true);
		const keys = keysOf(output);
		// Labels follow the sample's slot order, so only the split is fixed.
		const listKeys = new Set(keys.filter((_, index) => index % 2 === 0));
		const detailKeys = new Set(keys.filter((_, index) => index % 2 === 1));
		expect(listKeys.size).toBe(1);
		expect(detailKeys.size).toBe(1);
		expect(listKeys).not.toEqual(detailKeys);
		expect(output.units.flatMap((unit) => [...unit.memberPageIndices])).toHaveLength(100);
		expect(events[0]).toEqual({
			phase: 'pass1-block-complete',
			blockKey: 'path:news',
			blocksProcessed: 1,
			totalBlocks: 1,
		});
	});

	it('produces the same keys on every run', async () => {
		const pages = Array.from({ length: 150 }, (_, index) => ({
			html: index % 3 === 0 ? LIST : DETAIL,
		}));
		const first = await classify(pages, true);
		const second = await classify(pages, true);
		expect(keysOf(second.output)).toEqual(keysOf(first.output));
		expect(second.output.tokens).toEqual(first.output.tokens);
	});

	it('produces the same keys and token table for varied pages on every run', async () => {
		const pages = Array.from({ length: 150 }, (_, index) => ({
			html: `<body><main><div class="v${index % 7}"><section class="s${index % 5}"><p>${index}</p></section></div></main></body>`,
		}));
		const first = await classify(pages, true);
		for (let repeat = 0; repeat < 3; repeat++) {
			const again = await classify(pages, true);
			expect(keysOf(again.output)).toEqual(keysOf(first.output));
			expect(again.output.tokens).toEqual(first.output.tokens);
		}
	});

	it('streams the same result whether pages come in one call or in batches with unread pages blanked', async () => {
		const pages = Array.from({ length: 200 }, (_, index) => ({
			html: index % 2 === 0 ? LIST : DETAIL,
		}));
		const whole = await classify(pages, true);

		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(pages.length),
			streaming: true,
		});
		const pushInBatches = async (
			push: (batch: StageAPage[]) => Promise<void>,
			mask: Uint8Array,
		) => {
			const masked = pages.map((page, index) => (mask[index] ? page : { html: '' }));
			for (let start = 0; start < masked.length; start += 64) {
				await push(masked.slice(start, start + 64));
			}
		};
		await pushInBatches((batch) => run.pushPages(batch), run.pageMask());
		await run.finishPages();
		expect(run.needsAssignment()).toBe(true);
		await pushInBatches((batch) => run.pushAssignmentPages(batch), run.pageMask());
		const batched = await run.takeOutput();
		expect(keysOf(batched)).toEqual(keysOf(whole.output));
	});

	it('marks the pages each read uses', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(150),
			streaming: true,
		});
		const firstMask = run.pageMask();
		expect(firstMask.reduce((sum, used) => sum + used, 0)).toBe(100);
		await run.pushPages(Array.from({ length: 150 }, () => ({ html: LIST })));
		await run.finishPages();
		const secondMask = run.pageMask();
		expect(secondMask.reduce((sum, used) => sum + used, 0)).toBe(50);
		expect(firstMask.every((used, index) => used !== secondMask[index])).toBe(true);
	});

	it('delivers every progress event of a call before the call resolves', async () => {
		const events: StageAProgress[] = [];
		const run = createTemplateStageARun({
			blockKeys: ['path:a', 'path:b', 'path:c'],
			blockOfPage: Uint32Array.of(0, 0, 1, 1, 2, 2),
			streaming: true,
			onProgress: (event) => events.push(event),
		});
		for (let block = 0; block < 3; block++) {
			await run.pushPages([{ html: LIST }, { html: DETAIL }]);
			expect(events).toHaveLength(block + 1);
		}
	});

	it('rejects with the error onProgress threw, then rejects every later call', async () => {
		const failure = new Error('progress sink failed');
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(1),
			streaming: false,
			onProgress: () => {
				throw failure;
			},
		});
		await run.pushPages([{ html: LIST }]);
		await expect(run.finishPages()).rejects.toBe(failure);
		await expect(run.takeOutput()).rejects.toBe(failure);
	});

	it('rejects a call made while the previous one is still running', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(2),
			streaming: false,
		});
		const first = run.pushPages([{ html: LIST }]);
		await expect(run.pushPages([{ html: LIST }])).rejects.toThrow(/still running/);
		expect(() => run.needsAssignment()).toThrow(/still running/);
		expect(() => run.pageMask()).toThrow(/still running/);
		await first;
	});

	it('stops the running call when cancelled', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(2000),
			streaming: false,
		});
		const call = run.pushPages(Array.from({ length: 2000 }, () => ({ html: DETAIL })));
		run.cancel();
		await expect(call).rejects.toThrow(/cancelled/);
	});

	it('rejects more pages than the run was created for', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(1),
			streaming: false,
		});
		await expect(run.pushPages([{ html: LIST }, { html: LIST }])).rejects.toThrow(
			/received page 2 of 1/,
		);
	});

	it('rejects finishing before every page was read', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(2),
			streaming: false,
		});
		await run.pushPages([{ html: LIST }]);
		await expect(run.finishPages()).rejects.toThrow(/received 1 pages of 2/);
	});

	it('rejects every call after cancel', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(1),
			streaming: false,
		});
		run.cancel();
		await expect(run.pushPages([{ html: LIST }])).rejects.toThrow(/cancelled/);
	});

	it('throws when a page names a block that does not exist', () => {
		expect(() =>
			createTemplateStageARun({
				blockKeys: ['path:news'],
				blockOfPage: Uint32Array.of(1),
				streaming: false,
			}),
		).toThrow(/out of range/);
	});

	it('produces its output only once', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(1),
			streaming: false,
		});
		await run.pushPages([{ html: LIST }]);
		await run.finishPages();
		await run.takeOutput();
		await expect(run.takeOutput()).rejects.toThrow(/already produced/);
		expect(() => run.pageMask()).toThrow(/already produced/);
		expect(run.needsAssignment()).toBe(false);
	});

	it('rejects a streaming read with the error onProgress threw midway, and every later call', async () => {
		const failure = new Error('progress sink failed');
		let seen = 0;
		const run = createTemplateStageARun({
			blockKeys: ['path:a', 'path:b', 'path:c'],
			blockOfPage: Uint32Array.of(0, 0, 1, 1, 2, 2),
			streaming: true,
			onProgress: () => {
				seen++;
				if (seen === 2) throw failure;
			},
		});
		await expect(
			run.pushPages(Array.from({ length: 6 }, () => ({ html: LIST }))),
		).rejects.toBe(failure);
		await expect(run.finishPages()).rejects.toBe(failure);
	});
});
