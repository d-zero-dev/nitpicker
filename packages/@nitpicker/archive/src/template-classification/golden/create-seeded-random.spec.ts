import { describe, expect, it } from 'vitest';

import { createSeededRandom } from './create-seeded-random.js';

describe('createSeededRandom', () => {
	it('seed 1 の先頭 3 値は mulberry32 の参照値と一致する', () => {
		const random = createSeededRandom(1);

		expect([random(), random(), random()]).toEqual([
			0.627_073_940_588_161_3, 0.002_735_721_180_215_478, 0.527_447_039_959_952_2,
		]);
	});

	it('同じ seed からは同じ列、違う seed からは違う列が出る', () => {
		const a = createSeededRandom(426);
		const b = createSeededRandom(426);
		const c = createSeededRandom(427);

		const first = [a(), a(), a()];

		expect([b(), b(), b()]).toEqual(first);
		expect([c(), c(), c()]).not.toEqual(first);
	});

	it('値は常に [0, 1) に収まる', () => {
		const random = createSeededRandom(0);
		const values = Array.from({ length: 10_000 }, () => random());

		expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
	});
});
