import { describe, it, expect } from 'vitest';

import { evictOutageTaintedDnsBurns } from './evict-outage-tainted-dns-burns.js';

describe('evictOutageTaintedDnsBurns', () => {
	it('evicts a burn whose timestamp falls inside the window', () => {
		const cache = new Map([['a.example', 'dns' as const]]);
		const burnTimestamps = new Map([['a.example', 150]]);
		evictOutageTaintedDnsBurns({
			cache,
			burnTimestamps,
			window: { startedAt: 100, endedAt: 200 },
		});
		expect(cache.has('a.example')).toBe(false);
		expect(burnTimestamps.has('a.example')).toBe(false);
	});

	it('does NOT evict a burn whose timestamp falls before the window', () => {
		const cache = new Map([['a.example', 'dns' as const]]);
		const burnTimestamps = new Map([['a.example', 50]]);
		evictOutageTaintedDnsBurns({
			cache,
			burnTimestamps,
			window: { startedAt: 100, endedAt: 200 },
		});
		expect(cache.has('a.example')).toBe(true);
		expect(burnTimestamps.has('a.example')).toBe(true);
	});

	it('does NOT evict a burn whose timestamp falls after the window', () => {
		const cache = new Map([['a.example', 'dns' as const]]);
		const burnTimestamps = new Map([['a.example', 300]]);
		evictOutageTaintedDnsBurns({
			cache,
			burnTimestamps,
			window: { startedAt: 100, endedAt: 200 },
		});
		expect(cache.has('a.example')).toBe(true);
	});

	it('treats the window boundaries as inclusive', () => {
		const cache = new Map([
			['start-boundary', 'dns' as const],
			['end-boundary', 'dns' as const],
		]);
		const burnTimestamps = new Map([
			['start-boundary', 100],
			['end-boundary', 200],
		]);
		evictOutageTaintedDnsBurns({
			cache,
			burnTimestamps,
			window: { startedAt: 100, endedAt: 200 },
		});
		expect(cache.size).toBe(0);
	});

	it('never evicts a host present in the cache but absent from burnTimestamps (preload-seeded)', () => {
		// This is the provenance guarantee: preload-seeded hosts (from a
		// prior session's crawl_errors) are never added to burnTimestamps,
		// so they cannot be swept up here no matter how wide the window is.
		const cache = new Map([['preload-seeded.example', 'dns' as const]]);
		const burnTimestamps = new Map<string, number>();
		evictOutageTaintedDnsBurns({
			cache,
			burnTimestamps,
			window: { startedAt: -Infinity, endedAt: Infinity },
		});
		expect(cache.has('preload-seeded.example')).toBe(true);
	});

	it('evicts multiple in-window hosts while leaving out-of-window ones alone', () => {
		const cache = new Map([
			['in-window-1', 'dns' as const],
			['in-window-2', 'dns' as const],
			['out-of-window', 'dns' as const],
		]);
		const burnTimestamps = new Map([
			['in-window-1', 120],
			['in-window-2', 180],
			['out-of-window', 5000],
		]);
		evictOutageTaintedDnsBurns({
			cache,
			burnTimestamps,
			window: { startedAt: 100, endedAt: 200 },
		});
		expect(cache.has('in-window-1')).toBe(false);
		expect(cache.has('in-window-2')).toBe(false);
		expect(cache.has('out-of-window')).toBe(true);
	});
});
