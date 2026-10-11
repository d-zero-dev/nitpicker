import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { BENCH_CASES } from './bench-cases.mjs';

describe('BENCH_CASES', () => {
	it.each(Object.keys(BENCH_CASES))('names an existing script: bench-%s.mjs', (bench) => {
		expect(
			existsSync(path.resolve(import.meta.dirname, '..', `bench-${bench}.mjs`)),
		).toBe(true);
	});

	it('gives every bench at least one case and no duplicate case', () => {
		for (const cases of Object.values(BENCH_CASES)) {
			expect(cases.length).toBeGreaterThan(0);
			expect(new Set(cases).size).toBe(cases.length);
		}
	});
});
