import { describe, it, expect } from 'vitest';

import { getPageJsonLdOverview } from './get-page-jsonld-overview.js';

describe('getPageJsonLdOverview', () => {
	it('is exported as a function', () => {
		expect(typeof getPageJsonLdOverview).toBe('function');
		expect(getPageJsonLdOverview.length).toBe(2);
	});
});
