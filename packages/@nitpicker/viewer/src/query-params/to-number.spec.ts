import { describe, expect, it } from 'vitest';

import { toNumber } from './to-number.js';

describe('toNumber', () => {
	it('undefined を返す（値が undefined のとき）', () => {
		expect(toNumber()).toBeUndefined();
	});

	it('undefined を返す（空文字のとき）', () => {
		expect(toNumber('')).toBeUndefined();
	});

	it('整数文字列をパースする', () => {
		expect(toNumber('42')).toBe(42);
	});

	it('小数文字列をパースする', () => {
		expect(toNumber('3.14')).toBe(3.14);
	});

	it('数値でない文字列で TypeError を投げる', () => {
		expect(() => toNumber('abc')).toThrow(TypeError);
	});
});
