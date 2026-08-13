import { describe, it, expect } from 'vitest';

import { getPageTechnologies } from './get-page-technologies.js';

describe('getPageTechnologies', () => {
	it('is exported as a function', () => {
		expect(typeof getPageTechnologies).toBe('function');
		expect(getPageTechnologies.length).toBe(2);
	});
});
