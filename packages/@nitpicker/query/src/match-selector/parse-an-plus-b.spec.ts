import { describe, expect, it } from 'vitest';

import { parseAnPlusB } from './parse-an-plus-b.js';

describe('parseAnPlusB', () => {
	it.each([
		['odd', { a: 2, b: 1 }],
		['even', { a: 2, b: 0 }],
		['3', { a: 0, b: 3 }],
		['+3', { a: 0, b: 3 }],
		['-1', { a: 0, b: -1 }],
		['n', { a: 1, b: 0 }],
		['2n', { a: 2, b: 0 }],
		['2n+1', { a: 2, b: 1 }],
		['2n + 1', { a: 2, b: 1 }],
		['-n+3', { a: -1, b: 3 }],
		['+n-2', { a: 1, b: -2 }],
		['3n-1', { a: 3, b: -1 }],
		[' ODD ', { a: 2, b: 1 }],
		['2N+1', { a: 2, b: 1 }],
		['-n', { a: -1, b: 0 }],
		['0n+1', { a: 0, b: 1 }],
		['n+0', { a: 1, b: 0 }],
		['2n+ 1', { a: 2, b: 1 }],
	])('%s', (text, expected) => {
		expect(parseAnPlusB(text)).toEqual(expected);
	});

	it.each(['', 'x', '2x+1', 'n+', '1n+', '2n+1 of .a', '--n', 'n n', 'n+-1', '1.5'])(
		'rejects %j',
		(text) => {
			expect(() => parseAnPlusB(text)).toThrow(SyntaxError);
		},
	);
});
