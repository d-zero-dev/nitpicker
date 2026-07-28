import { describe, it, expect } from 'vitest';

import { formatInventorySkipSummary } from './format-inventory-skip-summary.js';

describe('formatInventorySkipSummary', () => {
	it('スキップ件数・総数・継続する有効件数を含むメッセージを組み立てる', () => {
		const message = formatInventorySkipSummary(12, 1234);
		expect(message).toBe(
			'[nitpicker] inventory list: 12 of 1234 lines skipped as invalid; continuing with 1222 URLs',
		);
	});

	it('スキップ件数が総数と一致する場合、継続件数は0になる', () => {
		const message = formatInventorySkipSummary(5, 5);
		expect(message).toContain('continuing with 0 URLs');
	});
});
