import { describe, expect, it } from 'vitest';

import { requireSampledPageUrl } from './require-sampled-page-url.js';

describe('requireSampledPageUrl', () => {
	it('returns the URL looked up for the page', () => {
		const urlByPageId = new Map([[7, 'https://example.com/a']]);
		expect(requireSampledPageUrl(urlByPageId, 7)).toBe('https://example.com/a');
	});

	it('throws, naming the page, when the lookup has no URL for it', () => {
		const urlByPageId = new Map([[7, 'https://example.com/a']]);
		expect(() => requireSampledPageUrl(urlByPageId, 8)).toThrow(/page 8 has no URL/);
	});

	it('does not mistake an empty URL string for a missing one', () => {
		expect(requireSampledPageUrl(new Map([[1, '']]), 1)).toBe('');
	});
});
