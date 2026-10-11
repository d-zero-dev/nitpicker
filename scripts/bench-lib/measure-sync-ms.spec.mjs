import { describe, it, expect } from 'vitest';

import { measureSyncMs } from './measure-sync-ms.mjs';

describe('measureSyncMs', () => {
	it('returns the work result and a non-negative elapsed time', () => {
		const { ms, value } = measureSyncMs(() => 'hashed');
		expect(value).toBe('hashed');
		expect(ms).toBeGreaterThanOrEqual(0);
	});

	it('measures at least the time the work spends', () => {
		const { ms } = measureSyncMs(() => {
			const until = performance.now() + 5;
			while (performance.now() < until) {
				// busy-wait: the work itself must take the time
			}
		});
		expect(ms).toBeGreaterThanOrEqual(5);
	});

	it('lets an error from the work propagate', () => {
		expect(() =>
			measureSyncMs(() => {
				throw new Error('boom');
			}),
		).toThrow('boom');
	});
});
