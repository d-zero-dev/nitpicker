import { describe, it, expect } from 'vitest';

import { validateSplitScopeUrls } from './validate-split-scope-urls.js';

describe('validateSplitScopeUrls', () => {
	it('deduplicates while preserving argument order', () => {
		expect(
			validateSplitScopeUrls([
				'https://example.com/blog/',
				'https://example.com/docs/',
				'https://example.com/blog/',
			]),
		).toEqual(['https://example.com/blog/', 'https://example.com/docs/']);
	});

	it('throws when given no URLs', () => {
		expect(() => validateSplitScopeUrls([])).toThrow(/at least one/);
	});

	it('throws for an invalid URL', () => {
		expect(() => validateSplitScopeUrls(['not a url'])).toThrow(/Not a valid URL/);
	});
});
