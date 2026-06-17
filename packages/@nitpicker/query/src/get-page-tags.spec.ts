import { describe, it, expect } from 'vitest';

import { getPageTags } from './get-page-tags.js';

describe('getPageTags', () => {
	it('is exported as a function', () => {
		expect(typeof getPageTags).toBe('function');
		expect(getPageTags.length).toBe(2);
	});
});
