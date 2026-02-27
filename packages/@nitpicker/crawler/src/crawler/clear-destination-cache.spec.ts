import { describe, it, expect } from 'vitest';

import { clearDestinationCache } from './clear-destination-cache.js';
import { destinationCache } from './destination-cache.js';

describe('clearDestinationCache', () => {
	it('clears all entries from the destination cache', () => {
		destinationCache.set('https://example.com/', new Error('test'));
		expect(destinationCache.size).toBe(1);

		clearDestinationCache();

		expect(destinationCache.size).toBe(0);
	});

	it('does not throw when cache is already empty', () => {
		destinationCache.clear();
		expect(() => clearDestinationCache()).not.toThrow();
	});
});
