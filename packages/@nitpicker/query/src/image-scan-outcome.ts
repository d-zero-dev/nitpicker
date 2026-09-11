import type { ImageScanOutcome } from './types.js';

/**
 * Ordered list of every {@link ImageScanOutcome}, for iterating in stable
 * display order (e.g. building a checklist filter) or producing typed
 * lookups. Independently defined from `@d-zero/beholder`'s `IMAGE_SCAN_CODE`
 * — not re-exported through `@nitpicker/crawler` — because this module is
 * imported by the viewer's browser bundle via the `@nitpicker/query/categories`
 * sub-export, which must have zero runtime dependencies on the Node-only
 * crawler package (see `categories.ts`). Parity between the two numeric
 * mappings is verified in this file's spec, not enforced by a shared import.
 */
export const IMAGE_SCAN_OUTCOMES: readonly ImageScanOutcome[] = [
	'ok',
	'degraded',
	'nav-unsettled',
	'frame-lost',
	'scroll-height-exceeded',
	'unknown',
] as const;

/**
 * Converts a `page_meta.image_scan_desktop` / `image_scan_mobile` integer
 * (`@d-zero/beholder`'s `IMAGE_SCAN_CODE`) to its {@link ImageScanOutcome}
 * name.
 * @param code - The stored column value.
 * @returns The matching outcome name, `null` when `code` is `null` (scan
 * never attempted), or `'unknown'` for any integer not in the known map
 * (e.g. an older/newer `@d-zero/beholder` version's code this build does
 * not recognise).
 * @example
 * ```ts
 * imageScanCodeToOutcome(0); // 'ok'
 * imageScanCodeToOutcome(null); // null
 * imageScanCodeToOutcome(99); // 'unknown'
 * ```
 */
export function imageScanCodeToOutcome(code: number | null): ImageScanOutcome | null {
	if (code === null) {
		return null;
	}
	switch (code) {
		case 0: {
			return 'ok';
		}
		case 1: {
			return 'degraded';
		}
		case 2: {
			return 'nav-unsettled';
		}
		case 3: {
			return 'frame-lost';
		}
		case 4: {
			return 'scroll-height-exceeded';
		}
		default: {
			return 'unknown';
		}
	}
}

/**
 * Reverse of {@link imageScanCodeToOutcome}, for building a SQL `WHERE ...
 * IN (...)` filter from a user-facing outcome name. `'unknown'` maps to
 * `255` (`@d-zero/beholder`'s only currently-defined fallback code) rather
 * than "every code not in the known set" — a filter that excludes a
 * not-yet-invented future code is an acceptable gap; scanning the whole
 * table for "not one of these five values" is not, for a facet this cheap.
 * @param outcome - The outcome name to convert.
 * @returns The `page_meta.image_scan_*` integer that produces this outcome.
 * @example
 * ```ts
 * imageScanOutcomeToCode('nav-unsettled'); // 2
 * ```
 */
export function imageScanOutcomeToCode(outcome: ImageScanOutcome): number {
	switch (outcome) {
		case 'ok': {
			return 0;
		}
		case 'degraded': {
			return 1;
		}
		case 'nav-unsettled': {
			return 2;
		}
		case 'frame-lost': {
			return 3;
		}
		case 'scroll-height-exceeded': {
			return 4;
		}
		case 'unknown': {
			return 255;
		}
	}
}
