import type { I18nValue } from '../types.js';
import type { FailureAttribution } from '@nitpicker/query';

/**
 * Lookup the localised label for a {@link FailureAttribution}.
 *
 * Used by Summary's `status = -1` breakdown sub-rows and by the Errors view
 * to keep the attribution labels identical across both screens — translators
 * only have to update one bag of strings under `views.attribution`.
 * @param attribution - The attribution to label.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The localised, human-readable label.
 */
export function getAttributionLabel(
	attribution: FailureAttribution,
	t: I18nValue['t'],
): string {
	const key = `views.attribution.${attribution}`;
	const label = t(key);
	// `t()` returns the key itself when no translation is found.
	return label === key ? attribution : label;
}
