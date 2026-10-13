import { describe, it, expect } from 'vitest';

import { formatBenchTable } from './format-bench-table.mjs';

const HEADER = [
	'| bench | case | pages | archive (MiB) | time (ms) | peak RSS (MiB) |',
	'|---|---|--:|--:|--:|--:|',
];

describe('formatBenchTable', () => {
	it('renders one row per record with sizes in MiB', () => {
		const table = formatBenchTable([
			{
				bench: 'body-hash',
				case: 'rust',
				input: { pages: 1000, archiveBytes: 104_857_600 },
				timeMs: 1234.5,
				peakRssBytes: 268_435_456,
				metrics: {},
			},
			{
				bench: 'body-hash',
				case: 'js',
				input: { pages: 1000, archiveBytes: 104_857_600 },
				timeMs: 2345.6,
				peakRssBytes: 314_572_800,
				metrics: {},
			},
		]);
		expect(table).toBe(
			[
				...HEADER,
				'| body-hash | rust | 1000 | 100.0 | 1234.5 | 256.0 |',
				'| body-hash | js | 1000 | 100.0 | 2345.6 | 300.0 |',
				'',
			].join('\n'),
		);
	});
});
