import { describe, expect, it } from 'vitest';

import { isPredictedContentDuplicate } from './is-predicted-content-duplicate.js';

describe('isPredictedContentDuplicate', () => {
	it('直前のhashがnullなら重複ではない', () => {
		expect(isPredictedContentDuplicate(Buffer.from('a'), null)).toBe(false);
	});

	it('同一バイト列のhashなら重複と判定する', () => {
		expect(isPredictedContentDuplicate(Buffer.from('same'), Buffer.from('same'))).toBe(
			true,
		);
	});

	it('異なるバイト列のhashなら重複ではない', () => {
		expect(isPredictedContentDuplicate(Buffer.from('a'), Buffer.from('b'))).toBe(false);
	});
});
