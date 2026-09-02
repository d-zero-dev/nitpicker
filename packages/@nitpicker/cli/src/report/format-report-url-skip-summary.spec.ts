import { describe, it, expect } from 'vitest';

import { formatReportUrlSkipSummary } from './format-report-url-skip-summary.js';

describe('formatReportUrlSkipSummary', () => {
	it('スキップ件数・総数・継続する有効件数を含むメッセージを組み立てる', () => {
		const message = formatReportUrlSkipSummary(12, 1234);
		expect(message).toBe(
			'[nitpicker] report list: 12 of 1234 lines skipped as invalid; continuing with 1222 URLs',
		);
	});

	it('スキップ件数が総数と一致する場合、継続件数は0になる', () => {
		const message = formatReportUrlSkipSummary(5, 5);
		expect(message).toContain('continuing with 0 URLs');
	});
});
