import { describe, it, expect } from 'vitest';

import { getPageJsonLd } from './get-page-jsonld.js';

describe('getPageJsonLd', () => {
	it('is exported as a function with optional slim flag', () => {
		expect(typeof getPageJsonLd).toBe('function');
		// `length` reports the count of required params before the first default;
		// (accessor, url) are required, `slim` has a default of `true`.
		expect(getPageJsonLd.length).toBe(2);
	});
});
