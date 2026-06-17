import { describe, it, expect } from 'vitest';

import { getTagInventory } from './get-tag-inventory.js';

describe('getTagInventory', () => {
	it('is exported as a function', () => {
		expect(typeof getTagInventory).toBe('function');
		expect(getTagInventory.length).toBe(1);
	});
});
