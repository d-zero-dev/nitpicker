import { describe, expect, it } from 'vitest';

import { getNextOffset } from './get-next-offset.js';

describe('getNextOffset', () => {
	it('残りがあれば「前回 offset + ページサイズ(100)」を返す', () => {
		expect(getNextOffset({ items: [], total: 250 }, 0)).toBe(100);
		expect(getNextOffset({ items: [], total: 250 }, 100)).toBe(200);
	});

	it('次の offset が total 以上なら undefined を返す（全件ロード済み）', () => {
		expect(getNextOffset({ items: [], total: 250 }, 200)).toBeUndefined();
	});

	it('境界: 次の offset がちょうど total なら undefined', () => {
		expect(getNextOffset({ items: [], total: 100 }, 0)).toBeUndefined();
	});
});
