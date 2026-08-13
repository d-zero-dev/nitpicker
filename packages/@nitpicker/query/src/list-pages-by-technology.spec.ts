import { describe, it, expect } from 'vitest';

import { listPagesByTechnology } from './list-pages-by-technology.js';

describe('listPagesByTechnology', () => {
	// Full E2E coverage lives in test-server's e2e suite; this spec just
	// pins the export shape so refactors do not silently drop the function.
	it('is exported as a function', () => {
		expect(typeof listPagesByTechnology).toBe('function');
		expect(listPagesByTechnology.length).toBe(2);
	});
});
