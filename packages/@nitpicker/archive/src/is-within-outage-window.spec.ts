import type { OutageWindow } from './is-within-outage-window.js';

import { describe, it, expect } from 'vitest';

import { isWithinOutageWindow } from './is-within-outage-window.js';

describe('isWithinOutageWindow', () => {
	it('returns false when there are no windows at all', () => {
		// This is what makes an archive with an empty (or absent)
		// `network_outages` table behave identically to today — every
		// existing archive, and every crawl that never detects an outage.
		expect(isWithinOutageWindow(1000, [])).toBe(false);
	});

	it('returns true for a timestamp strictly inside a single window', () => {
		const windows: OutageWindow[] = [{ startedAt: 500, endedAt: 1500 }];
		expect(isWithinOutageWindow(1000, windows)).toBe(true);
	});

	it('returns false for a timestamp strictly before every window', () => {
		const windows: OutageWindow[] = [{ startedAt: 500, endedAt: 1500 }];
		expect(isWithinOutageWindow(100, windows)).toBe(false);
	});

	it('returns false for a timestamp strictly after every window', () => {
		const windows: OutageWindow[] = [{ startedAt: 500, endedAt: 1500 }];
		expect(isWithinOutageWindow(2000, windows)).toBe(false);
	});

	it('treats the `startedAt` boundary as inclusive', () => {
		const windows: OutageWindow[] = [{ startedAt: 500, endedAt: 1500 }];
		expect(isWithinOutageWindow(500, windows)).toBe(true);
	});

	it('treats the `endedAt` boundary as inclusive', () => {
		// Both boundaries are inclusive by design: a false negative here
		// (treating a network-caused failure as site-caused forever) is
		// worse than a false positive (one extra retry pass).
		const windows: OutageWindow[] = [{ startedAt: 500, endedAt: 1500 }];
		expect(isWithinOutageWindow(1500, windows)).toBe(true);
	});

	it('returns true when the timestamp falls in any one of several windows', () => {
		const windows: OutageWindow[] = [
			{ startedAt: 0, endedAt: 100 },
			{ startedAt: 5000, endedAt: 6000 },
			{ startedAt: 10_000, endedAt: 20_000 },
		];
		expect(isWithinOutageWindow(5500, windows)).toBe(true);
	});

	it('returns false when the timestamp falls in the gap between two windows', () => {
		const windows: OutageWindow[] = [
			{ startedAt: 0, endedAt: 100 },
			{ startedAt: 5000, endedAt: 6000 },
		];
		expect(isWithinOutageWindow(2500, windows)).toBe(false);
	});

	it('handles overlapping windows without double-counting affecting the boolean result', () => {
		const windows: OutageWindow[] = [
			{ startedAt: 0, endedAt: 1000 },
			{ startedAt: 500, endedAt: 1500 },
		];
		expect(isWithinOutageWindow(750, windows)).toBe(true);
		expect(isWithinOutageWindow(1250, windows)).toBe(true);
		expect(isWithinOutageWindow(1999, windows)).toBe(false);
	});

	it('handles windows that are exactly adjacent (one ends where the next starts)', () => {
		const windows: OutageWindow[] = [
			{ startedAt: 0, endedAt: 1000 },
			{ startedAt: 1000, endedAt: 2000 },
		];
		// The shared boundary belongs to both windows under inclusive
		// semantics; either way the point is unambiguously "inside".
		expect(isWithinOutageWindow(1000, windows)).toBe(true);
	});

	it('never returns true for a window whose endedAt is null — callers must resolve open windows first', () => {
		// `OutageWindow.endedAt` is typed as `number`, never `null`, precisely
		// so an unresolved (crashed-session) row can't reach this function.
		// This test simulates a caller that bypassed the type contract (e.g.
		// forwarded a raw DB row without resolving it via `listNetworkOutages`)
		// and pins the actual runtime behaviour: `timestamp <= null` coerces
		// `null` to `0`, so the window becomes `[startedAt, 0]` — impossible
		// to match for any realistic (positive) `startedAt`/timestamp, not an
		// unbounded "matches everything after startedAt forever" window.
		const windows = [{ startedAt: 500, endedAt: null }] as unknown as OutageWindow[];
		expect(isWithinOutageWindow(500, windows)).toBe(false);
		expect(isWithinOutageWindow(600, windows)).toBe(false);
		expect(isWithinOutageWindow(1_500_000, windows)).toBe(false);
	});
});
