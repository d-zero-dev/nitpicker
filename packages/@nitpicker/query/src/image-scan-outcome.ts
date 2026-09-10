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
