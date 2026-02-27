import { describe, it, expect } from 'vitest';

import { cleanObject } from './clean-object.js';

describe('cleanObject', () => {
	it('removes undefined properties', () => {
		const result = cleanObject({ a: 1, b: undefined, c: 'hello' });
		expect(result).toEqual({ a: 1, c: 'hello' });
	});

	it('keeps null properties', () => {
		const result = cleanObject({ a: null, b: 0, c: '' });
		expect(result).toEqual({ a: null, b: 0, c: '' });
	});

	it('returns empty object for falsy input', () => {
		expect(cleanObject()).toEqual({});
	});

	it('returns same properties when no undefined values', () => {
		const obj = { x: 1, y: 2 };
		expect(cleanObject(obj)).toEqual({ x: 1, y: 2 });
	});
});
