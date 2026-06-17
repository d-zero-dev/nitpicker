import { describe, it, expect } from 'vitest';

import { listPagesByTag } from './list-pages-by-tag.js';

describe('listPagesByTag', () => {
	// Full E2E coverage lives in test-server's meta.e2e.ts; this spec just
	// pins the export shape so refactors do not silently drop the function.
	it('is exported as a function', () => {
		expect(typeof listPagesByTag).toBe('function');
		expect(listPagesByTag.length).toBe(2);
	});
});
