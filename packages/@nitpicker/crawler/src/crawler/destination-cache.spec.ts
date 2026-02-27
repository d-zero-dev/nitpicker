import { describe, it, expect } from 'vitest';

import { destinationCache } from './destination-cache.js';

describe('destinationCache', () => {
	it('is a Map instance', () => {
		expect(destinationCache).toBeInstanceOf(Map);
	});

	it('supports set and get operations', () => {
		destinationCache.set('test-key', new Error('test'));
		expect(destinationCache.has('test-key')).toBe(true);
		expect(destinationCache.get('test-key')).toBeInstanceOf(Error);
		destinationCache.delete('test-key');
	});

	it('supports clear operation', () => {
		destinationCache.set('key1', new Error('a'));
		destinationCache.set('key2', new Error('b'));
		destinationCache.clear();
		expect(destinationCache.size).toBe(0);
	});
});
