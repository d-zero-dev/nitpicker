import { describe, it, expect } from 'vitest';

import { countPagesByTag } from './count-pages-by-tag.js';

describe('countPagesByTag', () => {
	it('is exported as a function', () => {
		expect(typeof countPagesByTag).toBe('function');
		expect(countPagesByTag.length).toBe(2);
	});
});
