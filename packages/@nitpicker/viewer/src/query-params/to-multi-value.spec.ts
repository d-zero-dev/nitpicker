import { describe, expect, it } from 'vitest';

import { toMultiValue } from './to-multi-value.js';
import { toNumber } from './to-number.js';

describe('toMultiValue', () => {
	it('undefined を返す（values が undefined のとき）', () => {
		expect(toMultiValue(undefined, toNumber)).toBeUndefined();
	});

	it('空配列に対して空配列を返す', () => {
		expect(toMultiValue([], toNumber)).toEqual([]);
	});

	it('各要素にパーサーを適用する', () => {
		expect(toMultiValue(['200', '404'], toNumber)).toEqual([200, 404]);
	});

	it('パーサーが投げた例外をそのまま伝播する', () => {
		expect(() => toMultiValue(['abc'], toNumber)).toThrow(TypeError);
	});

	it('パーサーが undefined を返した要素を除外する（無効な値は無視する）', () => {
		const toEvenNumber = (value: string): number | undefined => {
			const n = Number(value);
			return n % 2 === 0 ? n : undefined;
		};
		expect(toMultiValue(['2', '3', '4'], toEvenNumber)).toEqual([2, 4]);
	});
});
