import type { GoldenRecord } from './types.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
	BLOCK_SAMPLE_SIZE,
	CORPUS_INLINE_THRESHOLD,
} from '../page-cluster/resolve-page-cluster-keys.js';

import { buildFixtureCorpus } from './build-fixture-corpus.js';
import { buildSyntheticSite } from './build-synthetic-site.js';
import { classifyGoldenCorpus } from './classify-golden-corpus.js';

const goldenDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(goldenDir, '..', 'page-cluster', '__fixtures__');

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

// The committed records were produced by the TypeScript engine and pin its
// output for any reimplementation (#426). How and when to regenerate them:
// archive README, "golden".
describe('テンプレート分類の golden: 合成サイト（in-memory 経路）', () => {
	let record: GoldenRecord;

	beforeAll(async () => {
		const pages = buildSyntheticSite({ seed: 426, scale: 1 });
		expect(pages.length).toBeLessThanOrEqual(CORPUS_INLINE_THRESHOLD);
		record = await classifyGoldenCorpus(pages);
	}, 120_000);

	it('分類が golden と一致する', async () => {
		await expect(serialize(record)).toMatchFileSnapshot(
			'__golden__/synthetic-in-memory.json',
		);
	});

	it('orphan の再割り当てとブロックをまたぐ統合を通る', () => {
		expect(record.templateKeys.some((key) => key.startsWith('["orphan-merge:'))).toBe(
			true,
		);
		expect(Math.max(...summarizeReasons(record).map(({ blocks }) => blocks))).toBe(2);
	});
});

describe('テンプレート分類の golden: 合成サイト（streaming 経路）', () => {
	let record: GoldenRecord;

	beforeAll(async () => {
		const pages = buildSyntheticSite({ seed: 420, scale: 77 });
		expect(pages.length).toBeGreaterThan(CORPUS_INLINE_THRESHOLD);
		record = await classifyGoldenCorpus(pages);
	}, 120_000);

	it('分類が golden と一致する', async () => {
		await expect(serialize(record)).toMatchFileSnapshot(
			'__golden__/synthetic-streaming.json',
		);
	});

	it('標本抽出とブロックをまたぐ統合を通る', () => {
		const reasons = summarizeReasons(record);

		// Reasons are built from the sampled members only, so a block larger
		// than the sample reports at most the sample size.
		expect(Math.max(...reasons.map(({ memberCount }) => memberCount))).toBe(
			BLOCK_SAMPLE_SIZE,
		);
		expect(Math.max(...reasons.map(({ blocks }) => blocks))).toBe(2);
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
