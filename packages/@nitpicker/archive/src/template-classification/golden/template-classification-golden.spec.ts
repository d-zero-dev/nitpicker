import type { GoldenRecord } from './types.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTemplateClassificationRun } from '@nitpicker/core/create-template-classification-run';
import { TEMPLATE_BLOCK_SAMPLE_SIZE as BLOCK_SAMPLE_SIZE } from '@nitpicker/core/template-block-sample-size';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildFixtureCorpus } from './build-fixture-corpus.js';
import { buildSyntheticSite } from './build-synthetic-site.js';
import { classifyGoldenCorpus } from './classify-golden-corpus.js';

const goldenDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(goldenDir, '..', 'page-cluster', '__fixtures__');

/**
 * Bytes of a Stage A similarity table over `pages` pages.
 * @param pages - A block's page count.
 * @returns The table's size.
 */
function pairBytes(pages: number): number {
	return ((pages * (pages - 1)) / 2) * 8;
}

/**
 * A budget under which the 4,774-, 3,542- and 3,080-page blocks of the large
 * synthetic site are clustered from a sample and the others (at most 2,310
 * pages) whole.
 */
const BUDGET_SAMPLING_THREE_LARGEST_BLOCKS = pairBytes(3000);

/**
 * @param record - A classification.
 * @returns Its committed text.
 */
function serialize(record: GoldenRecord): string {
	return `${JSON.stringify(record, null, '\t')}\n`;
}

/**
 * @param record - A classification.
 * @returns Each reason's `memberCount` and number of blocks it spans.
 */
function summarizeReasons(
	record: GoldenRecord,
): { memberCount: number; blocks: number }[] {
	return Object.values(record.clusterReasonJsonByTemplateKey).map((json) => {
		const reason = JSON.parse(json) as { memberCount: number; blocking: unknown[] };
		return { memberCount: reason.memberCount, blocks: reason.blocking.length };
	});
}

// The committed records pin the classifier's output, so a change to it shows
// as a diff of stored keys and reasons. How and when to regenerate them:
// archive README, "golden".
describe('テンプレート分類の golden: 合成サイト（全ブロックを厳密に計算）', () => {
	let record: GoldenRecord;

	beforeAll(async () => {
		record = await classifyGoldenCorpus(buildSyntheticSite({ seed: 426, scale: 1 }));
	}, 120_000);

	it('分類が golden と一致する', async () => {
		await expect(serialize(record)).toMatchFileSnapshot(
			'__golden__/synthetic-small.json',
		);
	});

	it('orphan の再割り当てとブロックをまたぐ統合を通る', () => {
		expect(record.templateKeys.some((key) => key.startsWith('["orphan-merge:'))).toBe(
			true,
		);
		expect(Math.max(...summarizeReasons(record).map(({ blocks }) => blocks))).toBe(2);
	});
});

describe('テンプレート分類の golden: 大規模な合成サイト', () => {
	const pages = buildSyntheticSite({ seed: 420, scale: 77 });

	// 20,255 pages: the blocks clustered whole would hold more than 20,000, so
	// the largest (4,774 pages) is clustered from a sample and the rest whole.
	describe('既定のメモリ上限（最大のブロックだけが保持ページ数の上限で標本に落ちる）', () => {
		let record: GoldenRecord;

		beforeAll(async () => {
			expect(pages.length).toBe(20_255);
			record = await classifyGoldenCorpus(pages);
		}, 300_000);

		it('分類が golden と一致する', async () => {
			await expect(serialize(record)).toMatchFileSnapshot(
				'__golden__/synthetic-exact.json',
			);
		});

		it('標本に落ちたブロックと、全ページを数えたブロックの両方の理由を持つ', () => {
			const memberCounts = summarizeReasons(record).map(({ memberCount }) => memberCount);

			expect(memberCounts).toContain(BLOCK_SAMPLE_SIZE);
			expect(Math.max(...memberCounts)).toBeGreaterThan(BLOCK_SAMPLE_SIZE);
		});
	});

	describe('メモリ上限 0（全ブロックを標本から計算）', () => {
		let record: GoldenRecord;

		beforeAll(async () => {
			record = await classifyGoldenCorpus(pages, { memoryBudget: 0 });
		}, 300_000);

		// The committed record pins the output of a run that samples every block.
		it('全ブロックを標本から計算した分類が golden と一致する', async () => {
			await expect(serialize(record)).toMatchFileSnapshot(
				'__golden__/synthetic-sample-all.json',
			);
		});

		it('理由は標本のメンバーだけから作られる', () => {
			const reasons = summarizeReasons(record);

			expect(Math.max(...reasons.map(({ memberCount }) => memberCount))).toBe(
				BLOCK_SAMPLE_SIZE,
			);
			expect(Math.max(...reasons.map(({ blocks }) => blocks))).toBe(2);
		});
	});

	describe('メモリ上限が大きいブロックだけを超える（標本と厳密の混在）', () => {
		let record: GoldenRecord;

		beforeAll(async () => {
			record = await classifyGoldenCorpus(pages, {
				memoryBudget: BUDGET_SAMPLING_THREE_LARGEST_BLOCKS,
			});
		}, 300_000);

		it('分類が golden と一致する', async () => {
			await expect(serialize(record)).toMatchFileSnapshot(
				'__golden__/synthetic-mixed.json',
			);
		});

		it('標本に落ちたブロックと厳密に計算したブロックの両方の理由を持つ', () => {
			const memberCounts = summarizeReasons(record).map(({ memberCount }) => memberCount);

			expect(memberCounts).toContain(BLOCK_SAMPLE_SIZE);
			expect(Math.max(...memberCounts)).toBeGreaterThan(BLOCK_SAMPLE_SIZE);
		});
	});
});

/**
 * The blocks `block()` reports as sampled for the large synthetic site under
 * `memoryBudget`, as `[pageCount, reason]` in block order. Blocking reads the
 * signals only, so no HTML is classified.
 * @param memoryBudget - Bytes a block's similarity table may take.
 * @returns Each sampled block's page count and why it was sampled.
 */
async function sampledBlocksOfLargeSite(
	memoryBudget: number,
): Promise<[number, string][]> {
	const events: { phase: string; pageCount?: number; reason?: string }[] = [];
	const run = createTemplateClassificationRun({
		memoryBudget,
		onProgress: (event) => events.push(event),
	});
	run.pushSignals(
		buildSyntheticSite({ seed: 420, scale: 77 }).map((page) => ({
			paths: page.paths,
			stylesheetHrefs: page.stylesheetHrefs,
			...(page.host === undefined ? {} : { host: page.host }),
		})),
	);
	await run.block();
	run.cancel();
	return events
		.filter((event) => event.phase === 'block-sampled')
		.map((event) => [event.pageCount!, event.reason!]);
}

describe('テンプレート分類の golden: 大規模な合成サイトでサンプルに落ちるブロック', () => {
	it('既定のメモリ上限では、最大のブロックだけが保持ページ数の上限で落ちる', async () => {
		expect(await sampledBlocksOfLargeSite(536_870_912)).toEqual([
			[4774, 'pages-over-limit'],
		]);
	});

	it('メモリ上限 0 では、標本より大きい全ブロックがメモリ上限で落ちる', async () => {
		expect(await sampledBlocksOfLargeSite(0)).toEqual([
			[4774, 'table-over-budget'],
			[1694, 'table-over-budget'],
			[3542, 'table-over-budget'],
			[2310, 'table-over-budget'],
			[1925, 'table-over-budget'],
			[693, 'table-over-budget'],
			[847, 'table-over-budget'],
			[924, 'table-over-budget'],
			[3080, 'table-over-budget'],
			[462, 'table-over-budget'],
		]);
	});

	it('メモリ上限が 3,000 ページ分の表だけを許すと、それを超える 3 ブロックだけが落ちる', async () => {
		expect(await sampledBlocksOfLargeSite(BUDGET_SAMPLING_THREE_LARGEST_BLOCKS)).toEqual([
			[4774, 'table-over-budget'],
			[3542, 'table-over-budget'],
			[3080, 'table-over-budget'],
		]);
	});
});

describe('テンプレート分類の golden: HTML fixture コーパス', () => {
	let record: GoldenRecord;

	beforeAll(async () => {
		record = await classifyGoldenCorpus(buildFixtureCorpus(fixturesDir));
	}, 120_000);

	it('分類が golden と一致する', async () => {
		await expect(serialize(record)).toMatchFileSnapshot('__golden__/fixtures.json');
	});
});
