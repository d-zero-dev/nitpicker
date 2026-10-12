import { describe, it, expect } from 'vitest';

import { createBenchResult } from './create-bench-result.mjs';

describe('createBenchResult', () => {
	it('lays the measurement out in the fixed record shape, rounding time to the microsecond', () => {
		expect(
			createBenchResult({
				bench: 'body-hash',
				caseName: 'rust',
				pageCount: 2,
				archiveBytes: 3_312_640,
				timeMs: 12.345_678,
				peakRssBytes: 116_000_000,
				metrics: { snapshots: 2 },
				env: { node: 'v24.20.0', platform: 'linux', arch: 'x64' },
			}),
		).toEqual({
			bench: 'body-hash',
			case: 'rust',
			input: { pages: 2, archiveBytes: 3_312_640 },
			env: { node: 'v24.20.0', platform: 'linux', arch: 'x64' },
			timeMs: 12.346,
			peakRssBytes: 116_000_000,
			metrics: { snapshots: 2 },
		});
	});
});
