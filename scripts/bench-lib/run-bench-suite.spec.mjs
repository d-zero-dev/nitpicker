import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runBenchSuite } from './run-bench-suite.mjs';

const CASES = { 'body-hash': ['rust', 'js'], 'tech-signals': ['default'] };

describe('runBenchSuite', () => {
	let consoleError;

	beforeEach(() => {
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('runs every case of every bench in order', async () => {
		const runCase = vi.fn(async (bench, caseName) => ({ bench, case: caseName }));
		const { records, failures } = await runBenchSuite({
			cases: CASES,
			only: new Set(),
			runCase,
		});
		expect(records).toEqual([
			{ bench: 'body-hash', case: 'rust' },
			{ bench: 'body-hash', case: 'js' },
			{ bench: 'tech-signals', case: 'default' },
		]);
		expect(failures).toEqual([]);
	});

	it('runs only the selected benches', async () => {
		const runCase = vi.fn(async (bench, caseName) => ({ bench, case: caseName }));
		const { records } = await runBenchSuite({
			cases: CASES,
			only: new Set(['tech-signals']),
			runCase,
		});
		expect(records).toEqual([{ bench: 'tech-signals', case: 'default' }]);
	});

	it('records a failed case, prints its error, and carries on with the rest', async () => {
		const runCase = vi.fn(async (bench, caseName) => {
			if (caseName === 'js') {
				throw new Error('bench-body-hash --case js exited with 1');
			}
			return { bench, case: caseName };
		});
		const { records, failures } = await runBenchSuite({
			cases: CASES,
			only: new Set(),
			runCase,
		});
		expect(failures).toEqual(['body-hash / js']);
		expect(records).toEqual([
			{ bench: 'body-hash', case: 'rust' },
			{ bench: 'tech-signals', case: 'default' },
		]);
		expect(consoleError).toHaveBeenCalledWith('bench-body-hash --case js exited with 1');
	});
});
