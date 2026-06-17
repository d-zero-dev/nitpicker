import { describe, it, expect } from 'vitest';

import { countPagesByJsonLdType } from './count-pages-by-jsonld-type.js';

describe('countPagesByJsonLdType', () => {
	it('is exported as a function', () => {
		expect(typeof countPagesByJsonLdType).toBe('function');
		expect(countPagesByJsonLdType.length).toBe(2);
	});
});
