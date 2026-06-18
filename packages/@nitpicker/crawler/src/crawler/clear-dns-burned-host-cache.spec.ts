import { describe, it, expect } from 'vitest';

import { clearDnsBurnedHostCache } from './clear-dns-burned-host-cache.js';
import { dnsBurnedHostCache } from './dns-burned-host-cache.js';
import { dnsBurnedHostShortCircuitCounter } from './dns-burned-host-short-circuit-counter.js';

describe('clearDnsBurnedHostCache', () => {
	it('empties the cache map', () => {
		dnsBurnedHostCache.set('foo.invalid', 'dns');
		dnsBurnedHostCache.set('bar.invalid', 'dns');
		clearDnsBurnedHostCache();
		expect(dnsBurnedHostCache.size).toBe(0);
	});

	it('resets the short-circuit counter to zero', () => {
		dnsBurnedHostShortCircuitCounter.count = 42;
		clearDnsBurnedHostCache();
		expect(dnsBurnedHostShortCircuitCounter.count).toBe(0);
	});

	it('is idempotent when called on an already-empty cache', () => {
		clearDnsBurnedHostCache();
		expect(() => clearDnsBurnedHostCache()).not.toThrow();
		expect(dnsBurnedHostCache.size).toBe(0);
		expect(dnsBurnedHostShortCircuitCounter.count).toBe(0);
	});
});
