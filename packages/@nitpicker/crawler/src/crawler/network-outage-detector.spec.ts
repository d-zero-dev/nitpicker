import type { ErrorKind } from '../types.js';

import { describe, it, expect } from 'vitest';

import NetworkOutageDetector from './network-outage-detector.js';

/**
 *
 * @param overrides
 * @param overrides.windowMs
 * @param overrides.errorThreshold
 * @param overrides.hostThreshold
 */
function makeDetector(overrides?: {
	windowMs?: number;
	errorThreshold?: number;
	hostThreshold?: number;
}) {
	return new NetworkOutageDetector({
		windowMs: overrides?.windowMs ?? 10_000,
		errorThreshold: overrides?.errorThreshold ?? 5,
		hostThreshold: overrides?.hostThreshold ?? 2,
	});
}

describe('NetworkOutageDetector', () => {
	describe('threshold boundaries', () => {
		it('does NOT trigger one record below the error threshold', () => {
			const detector = makeDetector({ errorThreshold: 3, hostThreshold: 1 });
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 1 })).toBeNull();
		});

		it('triggers exactly at the error threshold', () => {
			const detector = makeDetector({ errorThreshold: 3, hostThreshold: 1 });
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 1 })).toBeNull();
			const suspect = detector.record({ kind: 'dns', host: 'a.example', at: 2 });
			expect(suspect).not.toBeNull();
			expect(suspect?.triggerErrorCount).toBe(3);
		});

		it('does NOT trigger below the distinct-host threshold even with enough errors', () => {
			// All errors piling up on ONE host looks like a dying site, not an
			// operator-side network event.
			const detector = makeDetector({ errorThreshold: 3, hostThreshold: 2 });
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 1 })).toBeNull();
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 2 })).toBeNull();
		});

		it('triggers once both the error count AND distinct-host thresholds are met', () => {
			const detector = makeDetector({ errorThreshold: 3, hostThreshold: 2 });
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 1 })).toBeNull();
			const suspect = detector.record({ kind: 'dns', host: 'b.example', at: 2 });
			expect(suspect).not.toBeNull();
			expect(suspect?.triggerHostCount).toBe(2);
		});
	});

	describe('window boundary', () => {
		it('evicts an entry exactly at the window edge (kept when == windowMs old, dropped when older)', () => {
			const detector = makeDetector({
				windowMs: 1000,
				errorThreshold: 2,
				hostThreshold: 1,
			});
			// This entry is exactly 1000ms old at the check below (inclusive
			// boundary) — it should still count.
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			const suspect = detector.record({ kind: 'dns', host: 'a.example', at: 1000 });
			expect(suspect).not.toBeNull();
		});

		it('does not count an entry older than the window', () => {
			const detector = makeDetector({
				windowMs: 1000,
				errorThreshold: 2,
				hostThreshold: 1,
			});
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			// 1001ms later — the first entry has aged out, so this is the only
			// entry in the window and the threshold (2) is not met.
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 1001 })).toBeNull();
		});

		it('does not let an aged-out entry contribute to the distinct-host count', () => {
			const detector = makeDetector({
				windowMs: 1000,
				errorThreshold: 1,
				hostThreshold: 2,
			});
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			// b.example arrives after a.example has aged out of the window —
			// only 1 distinct host remains, threshold (2) not met.
			expect(detector.record({ kind: 'dns', host: 'b.example', at: 2000 })).toBeNull();
		});
	});

	describe('non-network error kinds', () => {
		it('never triggers on site-specific error kinds, no matter how many arrive', () => {
			const detector = makeDetector({ errorThreshold: 1, hostThreshold: 1 });
			const siteSpecificKinds = [
				'tls',
				'connection-refused',
				'parse-error',
				'client-blocked',
				'redirect-loop',
				'timeout',
				'protocol',
				'unknown',
			] as const satisfies Exclude<
				ErrorKind,
				| 'dns'
				| 'dns-transient'
				| 'local-network'
				| 'connection-timeout'
				| 'connection-reset'
			>[];
			for (const kind of siteSpecificKinds) {
				const suspect = detector.record({ kind, host: 'a.example', at: 0 });
				expect(suspect, `kind=${kind} must never trigger`).toBeNull();
			}
		});

		it('treats every documented network-related kind as trigger-eligible', () => {
			const networkKinds = [
				'dns',
				'dns-transient',
				'local-network',
				'connection-timeout',
				'connection-reset',
			] as const satisfies ErrorKind[];
			for (const kind of networkKinds) {
				const detector = makeDetector({ errorThreshold: 2, hostThreshold: 1 });
				expect(detector.record({ kind, host: 'a.example', at: 0 })).toBeNull();
				const suspect = detector.record({ kind, host: 'a.example', at: 1 });
				expect(suspect, `kind=${kind} should be trigger-eligible`).not.toBeNull();
			}
		});
	});

	describe('startedAt backdating', () => {
		it('backdates startedAt to the oldest entry still in the window, not the trigger instant', () => {
			const detector = makeDetector({
				errorThreshold: 3,
				hostThreshold: 1,
				windowMs: 10_000,
			});
			detector.record({ kind: 'dns', host: 'a.example', at: 100 });
			detector.record({ kind: 'dns', host: 'a.example', at: 300 });
			const suspect = detector.record({ kind: 'dns', host: 'a.example', at: 500 });
			expect(suspect?.startedAt).toBe(100);
			expect(suspect?.detectedAt).toBe(500);
		});
	});

	describe('reset()', () => {
		it('clears the sliding window so prior errors no longer count toward a trigger', () => {
			const detector = makeDetector({ errorThreshold: 2, hostThreshold: 1 });
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			detector.reset();
			// Without the reset, this second record() would be the 2nd entry
			// and would trigger.
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 1 })).toBeNull();
		});
	});

	describe('reset after trigger', () => {
		it('does not fire twice on the same batch of errors', () => {
			const detector = makeDetector({ errorThreshold: 2, hostThreshold: 1 });
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 0 })).toBeNull();
			const first = detector.record({ kind: 'dns', host: 'a.example', at: 1 });
			expect(first).not.toBeNull();
			// Window was cleared on trigger — a single further error is not
			// enough to re-trigger immediately.
			const third = detector.record({ kind: 'dns', host: 'a.example', at: 2 });
			expect(third).toBeNull();
		});

		it('can trigger again once a fresh batch accumulates after a reset', () => {
			const detector = makeDetector({ errorThreshold: 2, hostThreshold: 1 });
			detector.record({ kind: 'dns', host: 'a.example', at: 0 });
			expect(detector.record({ kind: 'dns', host: 'a.example', at: 1 })).not.toBeNull();
			detector.record({ kind: 'dns', host: 'a.example', at: 2 });
			const secondSuspect = detector.record({ kind: 'dns', host: 'a.example', at: 3 });
			expect(secondSuspect).not.toBeNull();
			expect(secondSuspect?.triggerErrorCount).toBe(2);
		});
	});
});
