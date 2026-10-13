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

	it('rejects a call made while the previous one is still running', async () => {
		const run = createTemplateStageARun({
			blockKeys: ['path:news'],
			blockOfPage: new Uint32Array(2),
			streaming: false,
		});
		const first = run.pushPages([{ html: LIST }]);
		expect(() => run.pushPages([{ html: LIST }])).toThrow(/still running/);
		await first;
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
	});
});
