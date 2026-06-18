import { afterEach, describe, expect, it } from 'vitest';

import { dnsBurnedHostShortCircuitCounter } from './dns-burned-host-short-circuit-counter.js';

afterEach(() => {
	dnsBurnedHostShortCircuitCounter.count = 0;
});

describe('dnsBurnedHostShortCircuitCounter', () => {
	it('starts at zero', () => {
		expect(dnsBurnedHostShortCircuitCounter.count).toBe(0);
	});

	it('exposes a mutable count field — references to the same object share state', () => {
		// The counter is exported as `{ count: number }` (instead of a `let`
		// binding) so that mutations from one importer are visible to another;
		// `clearDnsBurnedHostCache` and the crawler worker rely on this.
		dnsBurnedHostShortCircuitCounter.count = 5;
		expect(dnsBurnedHostShortCircuitCounter.count).toBe(5);
		dnsBurnedHostShortCircuitCounter.count++;
		expect(dnsBurnedHostShortCircuitCounter.count).toBe(6);
	});
});
