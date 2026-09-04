import { describe, expect, it } from 'vitest';

import { computeAutoRetryBackoffDelayMs } from './compute-auto-retry-backoff-delay.js';

describe('computeAutoRetryBackoffDelayMs', () => {
	it('starts at 30 seconds for the first attempt', () => {
		expect(computeAutoRetryBackoffDelayMs(1)).toBe(30_000);
	});

	it('doubles for each subsequent attempt', () => {
		expect(computeAutoRetryBackoffDelayMs(2)).toBe(60_000);
		expect(computeAutoRetryBackoffDelayMs(3)).toBe(120_000);
		expect(computeAutoRetryBackoffDelayMs(4)).toBe(240_000);
	});

	it('caps at 5 minutes for later attempts', () => {
		expect(computeAutoRetryBackoffDelayMs(5)).toBe(300_000);
		expect(computeAutoRetryBackoffDelayMs(10)).toBe(300_000);
	});
});
