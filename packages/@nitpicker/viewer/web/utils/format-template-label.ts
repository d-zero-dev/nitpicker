import type { I18nValue } from '../types.js';
import type { TemplateLabel } from '@nitpicker/query';

import { ordinalToLetters } from './ordinal-to-letters.js';

/**
 * Renders a stored template label as the name people use for the template
 * in conversation: `events template A` / `events テンプレート A`, or
 * `template A` for a site-wide label (no section).
 *
 * The letter comes from {@link ordinalToLetters}; the surrounding words
 * come from the `views.templateLabel.*` translations so the order of
 * section and letter can differ per locale.
 * @param label - The label to render.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The localised name.
 * @example
 * ```ts
 * formatTemplateLabel({ section: 'events', ordinal: 2 }, t); // 'events template B'
 * ```
 */
export function formatTemplateLabel(label: TemplateLabel, t: I18nValue['t']): string {
	const letter = ordinalToLetters(label.ordinal);
	return label.section == null
		? t('views.templateLabel.siteWide', { letter })
		: t('views.templateLabel.sectioned', { section: label.section, letter });
}
