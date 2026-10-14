import type {
	TemplateClassificationOutput,
	TemplateClassificationProgress,
	TemplatePageHtml,
	TemplatePageSignals,
} from './types.js';

import { describe, it, expect } from 'vitest';

import { createTemplateClassificationRun } from './create-template-classification-run.js';

const LIST = '<body><main><ul><li><a>x</a></li><li><a>y</a></li></ul></main></body>';
const DETAIL =
	'<body><main><article><h1>t</h1><p>p</p><figure><img></figure></article></main></body>';

/** Pages of the block the sampling tests cluster from a sample. */
const SAMPLED_PAGE_COUNT = 2001;

/** Bytes of Stage A's similarity table over 2,001 pages: 2,001 * 2,000 / 2 * 8. */
const SAMPLED_PAIR_BYTES = 16_008_000;

/** Bytes of the table over 1,000 pages: a block of 1,000 fits, 2,001 does not. */
const SAMPLING_BUDGET = 3_996_000;

/**
 * `count` pages of one URL section, without stylesheets: one block.
 * @param count
 */
function newsSignals(count: number): TemplatePageSignals[] {
	return Array.from({ length: count }, (_, index) => ({
		paths: ['news', String(index)],
		stylesheetHrefs: [],
	}));
}

/**
 * Runs a whole classification, reading every page's HTML on each read.
 * @param signals
 * @param pages
 */
async function classify(
	signals: readonly TemplatePageSignals[],
	pages: readonly TemplatePageHtml[],
): Promise<{
	output: TemplateClassificationOutput;
	events: TemplateClassificationProgress[];
}> {
	const events: TemplateClassificationProgress[] = [];
	const run = createTemplateClassificationRun({
		onProgress: (event) => events.push(event),
	});
	run.pushSignals(signals);
	await run.block();
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
function keysOf(output: TemplateClassificationOutput): string[] {
	return Array.from(output.keyOfPage, (key) => output.keys[key]!);
}

describe('createTemplateClassificationRun', () => {
	it('splits a block holding two templates into two clusters', async () => {
		const { output } = await classify(
			newsSignals(4),
			[LIST, LIST, DETAIL, DETAIL].map((html) => ({ html })),
		);
		expect(keysOf(output)).toEqual([
			'["path:news","cluster:0"]',
			'["path:news","cluster:0"]',
			'["path:news","cluster:1"]',
			'["path:news","cluster:1"]',
		]);
	});

	it('explains each final cluster with its blocking, structure and landmarks', async () => {
		const withNav = '<body><nav><a>n</a></nav><main><p>x</p></main></body>';
		const { output } = await classify(newsSignals(2), [
			{ html: withNav },
			{ html: withNav },
		]);
		expect(output.reasons).toEqual(
			new Map([
				[
					'["path:news","cluster:0"]',
					{
						memberCount: 2,
						blocking: [
							{ blockKey: 'path:news', reason: { kind: 'path', pathKey: 'news' } },
						],
						structuralCoreTokens: ['body>main>p'],
						landmarks: {
							nav: {
								presenceRate: 1,
								chromeRate: 1,
								shellTokens: ['body>nav>a'],
								memberCountWithInstance: 2,
							},
						},
						siblingClusterKeys: [],
					},
				],
			]),
		);
	});

	it('builds each reason with the keys in the order the stored JSON has them', async () => {
		const withNav = '<body><nav><a>n</a></nav><main><p>x</p></main></body>';
		const { output } = await classify(newsSignals(2), [
			{ html: withNav },
			{ html: withNav },
		]);
		expect(JSON.stringify(output.reasons.get('["path:news","cluster:0"]'))).toBe(
			'{"memberCount":2,"blocking":[{"blockKey":"path:news","reason":{"kind":"path","pathKey":"news"}}],"structuralCoreTokens":["body>main>p"],"landmarks":{"nav":{"presenceRate":1,"chromeRate":1,"shellTokens":["body>nav>a"],"memberCountWithInstance":2}},"siblingClusterKeys":[]}',
		);
	});

	it('blocks pages by their first-party stylesheets only', async () => {
		const signals: TemplatePageSignals[] = [
			// The font is on another host than the page, so it is dropped and
			// both news pages share one stylesheet block.
			{
				paths: ['news', '1'],
				stylesheetHrefs: ['https://example.com/a.css', 'https://fonts.cdn.example/x'],
				host: 'example.com',
			},
			{
				paths: ['news', '2'],
				stylesheetHrefs: ['https://example.com/a.css'],
				host: 'example.com',
			},
			{
				paths: ['about'],
				stylesheetHrefs: ['https://example.com/b.css'],
				host: 'example.com',
			},
		];
		const { output } = await classify(
			signals,
			[LIST, LIST, DETAIL].map((html) => ({ html })),
		);
		const keys = keysOf(output);
		expect(keys[0]).toBe(keys[1]);
		expect(keys[0]!.startsWith('["css:')).toBe(true);
		expect(keys[2]).toBe('["path:about","cluster:0"]');
	});

	it('reports each block as it completes, then the merge across blocks', async () => {
		const { events } = await classify(newsSignals(1), [{ html: LIST }]);
		expect(events).toEqual([
			{
				phase: 'pass1-block-complete',
				blockKey: 'path:news',
				blocksProcessed: 1,
				totalBlocks: 1,
			},
			{ phase: 'stage-b-start', unitCount: 1 },
		]);
	});

	it('classifies an empty corpus to nothing', async () => {
		const { output } = await classify([], []);
		expect(output.keys).toEqual([]);
		expect([...output.keyOfPage]).toEqual([]);
		expect(output.reasons.size).toBe(0);
	});

	it('clusters a block over the memory budget from a sample and assigns the others', async () => {
		const pages = Array.from({ length: SAMPLED_PAGE_COUNT }, (_, index) => ({
			html: index % 2 === 0 ? LIST : DETAIL,
		}));
		const events: TemplateClassificationProgress[] = [];
		const run = createTemplateClassificationRun({
			memoryBudget: SAMPLING_BUDGET,
			onProgress: (event) => events.push(event),
		});
		run.pushSignals(newsSignals(SAMPLED_PAGE_COUNT));
		await run.block();
		const firstMask = run.pageMask();
		expect(firstMask.reduce((sum, used) => sum + used, 0)).toBe(100);
		const blankUnused = (mask: Uint8Array) =>
			pages.map((page, index) => (mask[index] ? page : { html: '' }));
		for (let start = 0; start < pages.length; start += 500) {
			await run.pushPages(blankUnused(firstMask).slice(start, start + 500));
		}
		await run.finishPages();
		expect(run.needsAssignment()).toBe(true);
		const secondMask = run.pageMask();
		expect(secondMask.reduce((sum, used) => sum + used, 0)).toBe(
			SAMPLED_PAGE_COUNT - 100,
		);
		expect(firstMask.every((used, index) => used !== secondMask[index])).toBe(true);
		await run.pushAssignmentPages(blankUnused(secondMask));
		const output = await run.takeOutput();

		const keys = keysOf(output);
		// Labels follow the sample's slot order, so only the split is fixed.
		const listKeys = new Set(keys.filter((_, index) => index % 2 === 0));
		const detailKeys = new Set(keys.filter((_, index) => index % 2 === 1));
		expect(listKeys.size).toBe(1);
		expect(detailKeys.size).toBe(1);
		expect(listKeys).not.toEqual(detailKeys);

		expect(output.sampledBlocks).toEqual([
			{
				blockKey: 'path:news',
				pageCount: SAMPLED_PAGE_COUNT,
				pairBytes: SAMPLED_PAIR_BYTES,
				reason: 'table-over-budget',
			},
		]);
		expect(events[0]).toEqual({
			phase: 'block-sampled',
			blockKey: 'path:news',
			pageCount: SAMPLED_PAGE_COUNT,
			pairBytes: SAMPLED_PAIR_BYTES,
			budget: SAMPLING_BUDGET,
			reason: 'table-over-budget',
		});
		// 2,001 pages less the 100 sampled are assigned, an event for every
		// 1,000 of them: the only one is at 1,000.
		const assignEvents = events.filter((event) => event.phase === 'pass1b-assign');
		expect(assignEvents).toEqual([
			{ phase: 'pass1b-assign', pagesAssigned: 1000, pagesToAssign: 1901 },
		]);
	});

	it('clusters every page of a block whole when its table fits the budget', async () => {
		const pages = Array.from({ length: SAMPLED_PAGE_COUNT }, (_, index) => ({
			html: index % 2 === 0 ? LIST : DETAIL,
		}));
		const run = createTemplateClassificationRun({
			memoryBudget: SAMPLED_PAIR_BYTES,
		});
		run.pushSignals(newsSignals(SAMPLED_PAGE_COUNT));
		await run.block();
		expect(run.pageMask().every((used) => used === 1)).toBe(true);
		await run.pushPages(pages);
		await run.finishPages();
		expect(run.needsAssignment()).toBe(false);
		const output = await run.takeOutput();
		expect(output.sampledBlocks).toEqual([]);
		const [reason] = [...output.reasons.values()];
		expect(reason?.memberCount).toBe(1001);
	});

	it('samples every block larger than a sample under a budget of zero', async () => {
		const run = createTemplateClassificationRun({ memoryBudget: 0 });
		run.pushSignals(newsSignals(101));
		await run.block();
		expect(run.pageMask().reduce((sum, used) => sum + used, 0)).toBe(100);
		await run.pushPages(Array.from({ length: 101 }, () => ({ html: LIST })));
		await run.finishPages();
		expect(run.needsAssignment()).toBe(true);
		await run.pushAssignmentPages(Array.from({ length: 101 }, () => ({ html: LIST })));
		const { sampledBlocks } = await run.takeOutput();
		expect(sampledBlocks).toEqual([
			{
				blockKey: 'path:news',
				pageCount: 101,
				pairBytes: 40_400,
				reason: 'table-over-budget',
			},
		]);
	});

	it('does not report a block no larger than a sample, even under a budget of zero', async () => {
		const run = createTemplateClassificationRun({ memoryBudget: 0 });
		run.pushSignals(newsSignals(1));
		await run.block();
		await run.pushPages([{ html: LIST }]);
		await run.finishPages();
		const { sampledBlocks } = await run.takeOutput();
		expect(sampledBlocks).toEqual([]);
	});

	it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects a memoryBudget of %s instead of sampling every block',
		(memoryBudget) => {
			expect(() => createTemplateClassificationRun({ memoryBudget })).toThrow(
				/memoryBudget must be a non-negative number of bytes/,
			);
		},
	);

	it('delivers every progress event of a call before the call resolves', async () => {
		const events: TemplateClassificationProgress[] = [];
		const run = createTemplateClassificationRun({
			onProgress: (event) => events.push(event),
		});
		run.pushSignals(
			['a', 'b', 'c'].flatMap((section) => [
				{ paths: [section, '1'], stylesheetHrefs: [] },
				{ paths: [section, '2'], stylesheetHrefs: [] },
			]),
		);
		await run.block();
		await run.pushPages(Array.from({ length: 6 }, () => ({ html: LIST })));
		await run.finishPages();
		expect(events).toHaveLength(3);
		await run.takeOutput();
		expect(events).toHaveLength(4);
	});

	it('rejects with the error onProgress threw, then rejects every later call', async () => {
		const failure = new Error('progress sink failed');
		const run = createTemplateClassificationRun({
			onProgress: () => {
				throw failure;
			},
		});
		run.pushSignals(newsSignals(1));
		await run.block();
		await run.pushPages([{ html: LIST }]);
		await expect(run.finishPages()).rejects.toBe(failure);
		await expect(run.takeOutput()).rejects.toBe(failure);
		expect(() => run.pushSignals([])).toThrow(failure);
	});

	it('rejects a call made while the previous one is still running', async () => {
		const run = createTemplateClassificationRun();
		run.pushSignals(newsSignals(2));
		await run.block();
		const first = run.pushPages([{ html: LIST }]);
		await expect(run.pushPages([{ html: LIST }])).rejects.toThrow(/still running/);
		expect(() => run.needsAssignment()).toThrow(/still running/);
		expect(() => run.pageMask()).toThrow(/still running/);
		expect(() => run.pushSignals([])).toThrow(/still running/);
		await first;
	});

	it('stops clustering at the next block once cancelled between the pushes and the finish', async () => {
		// Cancelled before `finishPages` starts, so the outcome does not depend on
		// how far a call has run: the cancel flag is read before each block.
		const run = createTemplateClassificationRun();
		run.pushSignals(
			['a', 'b', 'c'].flatMap((section) => [
				{ paths: [section, '1'], stylesheetHrefs: [] },
				{ paths: [section, '2'], stylesheetHrefs: [] },
			]),
		);
		await run.block();
		await run.pushPages(Array.from({ length: 6 }, () => ({ html: LIST })));
		run.cancel();
		await expect(run.finishPages()).rejects.toThrow(/cancelled/);
	});

	it('rejects every call after cancel', async () => {
		const run = createTemplateClassificationRun();
		run.pushSignals(newsSignals(1));
		run.cancel();
		await expect(run.block()).rejects.toThrow(/cancelled/);
	});

	it('rejects more pages than it has signals for', async () => {
		const run = createTemplateClassificationRun();
		run.pushSignals(newsSignals(1));
		await run.block();
		await expect(run.pushPages([{ html: LIST }, { html: LIST }])).rejects.toThrow(
			/received page 2 of 1/,
		);
	});

	it('rejects finishing before every page was read', async () => {
		const run = createTemplateClassificationRun();
		run.pushSignals(newsSignals(2));
		await run.block();
		await run.pushPages([{ html: LIST }]);
		await expect(run.finishPages()).rejects.toThrow(/received 1 pages of 2/);
	});

	it('rejects reading HTML before the signals are blocked', async () => {
		const run = createTemplateClassificationRun();
		run.pushSignals(newsSignals(1));
		expect(() => run.pageMask()).toThrow(/not been blocked/);
		await expect(run.pushPages([{ html: LIST }])).rejects.toThrow(/not been blocked/);
	});

	it('rejects signals after blocking', async () => {
		const run = createTemplateClassificationRun();
		run.pushSignals(newsSignals(1));
		await run.block();
		expect(() => run.pushSignals(newsSignals(1))).toThrow(/already blocked/);
	});

	it('produces its output only once', async () => {
		const run = createTemplateClassificationRun();
		run.pushSignals(newsSignals(1));
		await run.block();
		await run.pushPages([{ html: LIST }]);
		await run.finishPages();
		await run.takeOutput();
		await expect(run.takeOutput()).rejects.toThrow(/already produced/);
		expect(() => run.pageMask()).toThrow(/already produced/);
		expect(run.needsAssignment()).toBe(false);
	});
});
