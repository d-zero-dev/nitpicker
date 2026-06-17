import { describe, it, expect } from 'vitest';

import { listPagesByJsonLdType } from './list-pages-by-jsonld-type.js';

describe('listPagesByJsonLdType', () => {
	it('is exported as a function', () => {
		expect(typeof listPagesByJsonLdType).toBe('function');
		expect(listPagesByJsonLdType.length).toBe(2);
	});
});
