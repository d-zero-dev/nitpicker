import { describe, it, expect } from 'vitest';

import { maskDynamicIds } from './mask-dynamic-ids.js';

describe('maskDynamicIds', () => {
	it('masks a mixed-alphanumeric token of 8+ characters', () => {
		expect(maskDynamicIds('id: a1b2c3d4 end')).toBe('id: __MASKED_ID__ end');
	});

	it('does not mask a pure-digit token (e.g. a date or phone number)', () => {
		expect(maskDynamicIds('published 20240101')).toBe('published 20240101');
	});

	it('does not mask a pure-alphabetic token (an ordinary word)', () => {
		expect(maskDynamicIds('written in TypeScript today')).toBe(
			'written in TypeScript today',
		);
	});

	it('does not mask a 7-character mixed token (below the {8,} threshold)', () => {
		expect(maskDynamicIds('id: abc123x end')).toBe('id: abc123x end');
	});

	it('masks an 8-character mixed token (at the {8,} threshold)', () => {
		expect(maskDynamicIds('id: abc123xy end')).toBe('id: __MASKED_ID__ end');
	});

	it('masks multiple independent occurrences', () => {
		expect(maskDynamicIds('a1b2c3d4 and z9y8x7w6')).toBe(
			'__MASKED_ID__ and __MASKED_ID__',
		);
	});

	it('masks regardless of letter case', () => {
		expect(maskDynamicIds('token ABC123de here')).toBe('token __MASKED_ID__ here');
	});

	it('leaves short strings and punctuation-only text unchanged', () => {
		expect(maskDynamicIds('日本語のテキスト 123')).toBe('日本語のテキスト 123');
	});
});
