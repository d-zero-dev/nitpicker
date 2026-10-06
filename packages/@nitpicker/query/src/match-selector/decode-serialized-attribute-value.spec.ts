import { describe, expect, it } from 'vitest';

import { decodeSerializedAttributeValue } from './decode-serialized-attribute-value.js';

describe('decodeSerializedAttributeValue', () => {
	it.each([
		['/?a=1&amp;b=2', '/?a=1&b=2'],
		['&lt;b&gt;', '<b>'],
		['say &quot;hi&quot;', 'say "hi"'],
		['a&nbsp;b', 'a b'],
		['plain', 'plain'],
		['', ''],
	])('%j → %j', (stored, decoded) => {
		expect(decodeSerializedAttributeValue(stored)).toBe(decoded);
	});

	it('decodes in a single pass', () => {
		expect(decodeSerializedAttributeValue('&amp;lt;')).toBe('&lt;');
		expect(decodeSerializedAttributeValue('&amp;amp;')).toBe('&amp;');
	});

	it('leaves any other ampersand alone', () => {
		expect(decodeSerializedAttributeValue('a&copy;b & c')).toBe('a&copy;b & c');
	});
});
