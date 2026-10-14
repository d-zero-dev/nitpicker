import { describe, it, expect } from 'vitest';

import { TEMPLATE_EXACT_PAGE_LIMIT } from './template-exact-page-limit.js';

describe('TEMPLATE_EXACT_PAGE_LIMIT', () => {
	it('is the pages of blocks clustered whole a run holds at once', () => {
		expect(TEMPLATE_EXACT_PAGE_LIMIT).toBe(20_000);
	});
});
