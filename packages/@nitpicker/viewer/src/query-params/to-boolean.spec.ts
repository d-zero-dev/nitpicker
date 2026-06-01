import { describe, expect, it } from 'vitest';

import { toBoolean } from './to-boolean.js';

describe('toBoolean', () => {
	it('undefined を返す（値が undefined のとき）', () => {
		expect(toBoolean()).toBeUndefined();
	});

	it('undefined を返す（空文字のとき）', () => {
		expect(toBoolean('')).toBeUndefined();
	});

	it('"true" を true にする', () => {
		expect(toBoolean('true')).toBe(true);
	});

	it('"false" を false にする', () => {
		expect(toBoolean('false')).toBe(false);
	});

	it('それ以外の文字列で TypeError を投げる', () => {
		expect(() => toBoolean('yes')).toThrow(TypeError);
	});
});
