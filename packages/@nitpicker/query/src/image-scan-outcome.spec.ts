import { describe, expect, it } from 'vitest';

import { IMAGE_SCAN_OUTCOMES, imageScanCodeToOutcome } from './image-scan-outcome.js';

describe('imageScanCodeToOutcome', () => {
	it('maps each known IMAGE_SCAN_CODE integer to its outcome name', () => {
		expect(imageScanCodeToOutcome(0)).toBe('ok');
		expect(imageScanCodeToOutcome(1)).toBe('degraded');
		expect(imageScanCodeToOutcome(2)).toBe('nav-unsettled');
		expect(imageScanCodeToOutcome(3)).toBe('frame-lost');
		expect(imageScanCodeToOutcome(4)).toBe('scroll-height-exceeded');
	});

	it('maps null (scan never attempted) to null, not "unknown"', () => {
		expect(imageScanCodeToOutcome(null)).toBeNull();
	});

	it('maps the reserved 255 code and any other unrecognised integer to "unknown"', () => {
		expect(imageScanCodeToOutcome(255)).toBe('unknown');
		expect(imageScanCodeToOutcome(6)).toBe('unknown');
		expect(imageScanCodeToOutcome(-1)).toBe('unknown');
	});
});

describe('IMAGE_SCAN_OUTCOMES', () => {
	it('lists every outcome name exactly once', () => {
		expect(IMAGE_SCAN_OUTCOMES).toEqual([
			'ok',
			'degraded',
			'nav-unsettled',
			'frame-lost',
			'scroll-height-exceeded',
			'unknown',
		]);
		expect(new Set(IMAGE_SCAN_OUTCOMES).size).toBe(IMAGE_SCAN_OUTCOMES.length);
	});
});
