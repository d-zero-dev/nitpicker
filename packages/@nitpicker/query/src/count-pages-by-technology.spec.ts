import { describe, it, expect } from 'vitest';

import { countPagesByTechnology } from './count-pages-by-technology.js';

describe('countPagesByTechnology', () => {
	it('is exported as a function', () => {
		expect(typeof countPagesByTechnology).toBe('function');
		expect(countPagesByTechnology.length).toBe(2);
	});
});
