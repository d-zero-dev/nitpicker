import { describe, it, expect } from 'vitest';

import { isBlobRefValue } from './is-blob-ref-value.js';

describe('isBlobRefValue', () => {
	it('returns true for a data: URI longer than the threshold', () => {
		expect(isBlobRefValue(`data:image/png;base64,${'x'.repeat(600)}`)).toBe(true);
	});

	it('returns false for a regular URL', () => {
		expect(isBlobRefValue('https://example.com/a.png')).toBe(false);
	});

	it('returns false for a data: URI at or below the threshold', () => {
		expect(isBlobRefValue(`data:image/png;base64,${'x'.repeat(10)}`)).toBe(false);
	});

	it('returns false for an empty string', () => {
		expect(isBlobRefValue('')).toBe(false);
	});
});
