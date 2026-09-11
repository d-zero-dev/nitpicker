import type { ImageScanOutcome } from '@nitpicker/query/categories';

import { describe, expect, it } from 'vitest';

import { getImageScanLabel } from './get-image-scan-label.js';

/**
 * Build a stub translate fn that returns whatever `dictionary` maps to and
 * falls back to the key itself when missing — mirroring the real `t()`.
 * @param dictionary - key → label mapping.
 * @returns A translate function compatible with {@link getImageScanLabel}.
 */
function tStub(dictionary: Record<string, string>) {
	return (key: string) => dictionary[key] ?? key;
}

describe('getImageScanLabel', () => {
	it('looks up the localised label via `views.imageScan.<outcome>`', () => {
		const t = tStub({
			'views.imageScan.ok': 'OK',
			'views.imageScan.frame-lost': 'Frame/session lost',
		});
		expect(getImageScanLabel('ok', t)).toBe('OK');
		expect(getImageScanLabel('frame-lost', t)).toBe('Frame/session lost');
	});

	it('falls back to the raw outcome when no translation is registered', () => {
		const t = tStub({});
		expect(getImageScanLabel('ok', t)).toBe('ok');
	});

	it('covers every outcome in the ImageScanOutcome union', () => {
		const outcomes: ImageScanOutcome[] = [
			'ok',
			'degraded',
			'nav-unsettled',
			'frame-lost',
			'scroll-height-exceeded',
			'unknown',
		];
		const t = tStub({});
		for (const outcome of outcomes) {
			expect(getImageScanLabel(outcome, t)).toBe(outcome);
		}
	});
});
