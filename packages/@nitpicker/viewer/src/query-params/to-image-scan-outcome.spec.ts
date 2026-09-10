import { describe, it, expect } from 'vitest';

import { toImageScanOutcome } from './to-image-scan-outcome.js';

describe('toImageScanOutcome', () => {
	it('returns undefined for missing input', () => {
		expect(toImageScanOutcome()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(toImageScanOutcome('')).toBeUndefined();
	});

	it('returns the narrowed value for every known outcome', () => {
		expect(toImageScanOutcome('ok')).toBe('ok');
		expect(toImageScanOutcome('degraded')).toBe('degraded');
		expect(toImageScanOutcome('nav-unsettled')).toBe('nav-unsettled');
		expect(toImageScanOutcome('frame-lost')).toBe('frame-lost');
		expect(toImageScanOutcome('scroll-height-exceeded')).toBe('scroll-height-exceeded');
		expect(toImageScanOutcome('unknown')).toBe('unknown');
	});

	it('returns undefined for unknown values (silent drop)', () => {
		expect(toImageScanOutcome('OK')).toBeUndefined();
		expect(toImageScanOutcome('bogus')).toBeUndefined();
		expect(toImageScanOutcome('__proto__')).toBeUndefined();
	});
});
