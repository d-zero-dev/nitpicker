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

	it('marks analysis-only records and explains the mark once', () => {
		const record = {
			bench: 'template-classification',
			input: { pages: 2, archiveBytes: 1_048_576 },
			timeMs: 9.2,
			peakRssBytes: 1_048_576,
		};
		const table = formatBenchTable([
			{ ...record, case: 'full', metrics: {} },
			{ ...record, case: 'breakdown', metrics: { analysisOnly: true } },
		]);
		expect(table).toBe(
			[
				...HEADER,
				'| template-classification | full | 2 | 1.0 | 9.2 | 1.0 |',
				'| template-classification | breakdown* | 2 | 1.0 | 9.2 | 1.0 |',
				'',
				'\\* Analysis run that re-drives internal stages to split their cost; its time is not the cost of the operation.',
				'',
			].join('\n'),
		);
	});
});
