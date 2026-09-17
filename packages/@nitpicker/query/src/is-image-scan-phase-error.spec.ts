import { describe, expect, it } from 'vitest';

import { isImageScanPhaseError } from './is-image-scan-phase-error.js';

describe('isImageScanPhaseError', () => {
	it('recognizes beholder image-scan skip messages for either viewport', () => {
		expect(
			isImageScanPhaseError(
				'📷 mobile-small: skipped — Navigation timeout of 15000 ms exceeded',
			),
		).toBe(true);
		expect(
			isImageScanPhaseError(
				'📷 desktop-compact: skipped — Protocol error (Page.reload): Not attached to an active page',
			),
		).toBe(true);
	});

	it('recognizes the scroll-height-guard skip message', () => {
		expect(
			isImageScanPhaseError(
				'📷 mobile-small: skipped — scrollHeight 50000 exceeds limit 20000',
			),
		).toBe(true);
	});

	it('does not match a genuine page-fetch failure', () => {
		expect(
			isImageScanPhaseError(
				'Scraper.#fetchData: gave up after 3 retries — Navigation timeout of 60000 ms exceeded',
			),
		).toBe(false);
	});

	it('does not match a crawler-channel message that merely mentions the same words', () => {
		expect(isImageScanPhaseError('Navigation timeout of 60000 ms exceeded')).toBe(false);
	});

	it('does not match an unrelated message, including one containing the emoji mid-string', () => {
		expect(isImageScanPhaseError('socket hang up')).toBe(false);
		expect(isImageScanPhaseError('see the 📷 icon in the report')).toBe(false);
	});

	it('does not match an empty string', () => {
		expect(isImageScanPhaseError('')).toBe(false);
	});
});
