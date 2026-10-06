import { describe, expect, it } from 'vitest';

import { encodeAttributeValuePattern } from './encode-attribute-value-pattern.js';

/**
 * Tests the encoded pattern of a value against a stored attribute value.
 * @param value - The selector's attribute value.
 * @param ignoreCase - Whether the test ignores ASCII case.
 * @param stored - The stored attribute value.
 */
function matches(value: string, ignoreCase: boolean, stored: string): boolean {
	return new RegExp(`^${encodeAttributeValuePattern(value, ignoreCase)}$`).test(stored);
}

describe('encodeAttributeValuePattern', () => {
	it.each([
		['a&b', 'a&amp;b'],
		['say "hi"', 'say &quot;hi&quot;'],
		['a b', 'a&nbsp;b'],
		['&amp;', '&amp;amp;'],
		['a.b', 'a.b'],
	])('encodes %j as the serializer would', (value, stored) => {
		expect(matches(value, false, stored)).toBe(true);
	});

	it('does not match the unencoded text', () => {
		expect(matches('a&b', false, 'a&b')).toBe(false);
	});

	it('folds ASCII case only outside the entities', () => {
		expect(matches('A&B', true, 'a&amp;b')).toBe(true);
		expect(matches('A&B', true, 'a&AMP;b')).toBe(false);
		expect(matches('A&B', false, 'a&amp;b')).toBe(false);
	});

	it.each(['a<b', 'a>b'])('has no single stored form for %j', (value) => {
		expect(encodeAttributeValuePattern(value, false)).toBeNull();
	});
});
