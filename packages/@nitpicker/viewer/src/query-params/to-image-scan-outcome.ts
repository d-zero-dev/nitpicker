import type { ImageScanOutcome } from '@nitpicker/query/categories';

import { IMAGE_SCAN_OUTCOMES } from '@nitpicker/query/categories';

/**
 * Parses a raw query-string value into an {@link ImageScanOutcome}.
 *
 * Same silent-drop convention as `toContentTypeCategory`: an unrecognised or
 * missing value returns `undefined` rather than throwing, so a stale
 * bookmark or a hostile client sending an arbitrary string gets the
 * un-filtered list instead of a 500.
 * @param raw - The raw query-string value.
 * @returns The narrowed outcome or `undefined`.
 */
export function toImageScanOutcome(
	raw: string | undefined,
): ImageScanOutcome | undefined {
	if (!raw) {
		return undefined;
	}
	return (IMAGE_SCAN_OUTCOMES as readonly string[]).includes(raw)
		? (raw as ImageScanOutcome)
		: undefined;
}
