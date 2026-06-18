import type { I18nValue } from '../types.js';
import type { ErrorKind } from '@nitpicker/query';

/**
 * Lookup the localised label for an {@link ErrorKind}.
 *
 * Used by Summary's `status = -1` breakdown sub-rows and by the Errors view
 * to keep the kind labels identical across both screens — translators only
 * have to update one bag of strings under `views.errorKind`.
 *
 * Unknown / future kinds fall back to the raw kind string so a new kind
 * introduced in the crawler does not display blank in older viewer builds.
 * @param kind - The error kind to label.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The localised, human-readable label.
 */
export function getErrorKindLabel(kind: ErrorKind, t: I18nValue['t']): string {
	const key = `views.errorKind.${kind}`;
	const label = t(key);
	// `t()` returns the key itself when no translation is found.
	return label === key ? kind : label;
}
