import { describe, it, expect } from 'vitest';

import { reservoirSample } from '../../packages/@nitpicker/archive/lib/template-classification/page-cluster/reservoir-sample.js';

import { selectStageASample } from './select-stage-a-sample.mjs';

const range = (length) => Array.from({ length }, (_, index) => index);

describe('selectStageASample', () => {
	it('gives Stage A the whole block in stream order on the in-memory path (20,000 pages or fewer)', () => {
		expect(
			selectStageASample({
				indices: range(500),
				blockKey: 'block-a',
				corpusSize: 20_000,
			}),
		).toEqual({ sample: range(500), rest: [] });
	});

	it('keeps a block of 100 pages or fewer whole on the streaming path', () => {
		expect(
			selectStageASample({
				indices: range(100),
				blockKey: 'block-a',
				corpusSize: 20_001,
			}),
		).toEqual({ sample: range(100), rest: [] });
	});

	it('samples 100 pages of a larger block on the streaming path and leaves the rest, in stream order, for Pass 1b', () => {
		const indices = range(1000).map((index) => index * 3);
		const { sample, rest } = selectStageASample({
			indices,
			blockKey: 'block-a',
			corpusSize: 20_001,
		});
		expect(sample).toHaveLength(100);
		expect(rest).toHaveLength(900);
		expect([...sample, ...rest].toSorted((a, b) => a - b)).toEqual(indices);
		expect(rest).toEqual(rest.toSorted((a, b) => a - b));
	});

	it('picks the same set of pages as the engine’s reservoirSample (same PRNG and seed)', () => {
		const indices = range(5000).map((index) => index * 7 + 3);
		for (const blockKey of ['block-a', '["css:abc","/news/"]', 'path:events']) {
			const { sample } = selectStageASample({ indices, blockKey, corpusSize: 30_000 });
			expect(new Set(sample)).toEqual(new Set(reservoirSample(indices, 100, blockKey)));
		}
	});

	it('keeps the reservoir-slot order, not input order, and a fixed result for a fixed input', () => {
		const { sample } = selectStageASample({
			indices: range(300),
			blockKey: 'block-a',
			corpusSize: 20_001,
		});
		expect(sample.toSorted((a, b) => a - b).slice(0, 10)).toEqual([
			1, 2, 7, 9, 19, 21, 24, 28, 29, 31,
		]);
		expect(sample).not.toEqual(sample.toSorted((a, b) => a - b));
	});

	it('picks the same sample for the same block key and a different one for another key', () => {
		const params = { indices: range(1000), corpusSize: 50_000 };
		const first = selectStageASample({ ...params, blockKey: 'block-a' }).sample;
		expect(selectStageASample({ ...params, blockKey: 'block-a' }).sample).toEqual(first);
		expect(selectStageASample({ ...params, blockKey: 'block-b' }).sample).not.toEqual(
			first,
		);
	});
});
