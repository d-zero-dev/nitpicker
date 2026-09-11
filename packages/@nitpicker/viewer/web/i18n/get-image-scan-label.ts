import type { I18nValue } from '../types.js';
import type { ImageScanOutcome } from '@nitpicker/query/categories';

/**
 * Lookup the localised label for an {@link ImageScanOutcome}.
 *
 * Used by the Pages view's checklist filter and by `MainContentSummary`'s
 * per-viewport badges to keep the outcome labels identical across both
 * screens — translators only have to update one bag of strings under
 * `views.imageScan`.
 *
 * Unknown / future outcomes fall back to the raw outcome string so a new
 * outcome introduced in `@d-zero/beholder` does not display blank in older
 * viewer builds.
 * @param outcome - The image-scan outcome to label.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The localised, human-readable label.
 */
export function getImageScanLabel(outcome: ImageScanOutcome, t: I18nValue['t']): string {
	const key = `views.imageScan.${outcome}`;
	const label = t(key);
	// `t()` returns the key itself when no translation is found.
	return label === key ? outcome : label;
}
