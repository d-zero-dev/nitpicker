import type { I18nValue } from '../types.js';
import type { TemplateClusterBlockingEvidence } from '@nitpicker/query';

/**
 * Lookup the localised label for a {@link TemplateClusterBlockingEvidence}'s
 * `reason.kind`.
 *
 * Same `views.<enum>.<value>` + raw-value-fallback pattern as
 * `getErrorKindLabel`/`getAttributionLabel` — a new blocking kind introduced
 * upstream (`@d-zero/page-cluster`) does not display blank in an older
 * viewer build.
 * @param kind - The blocking reason kind to label.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The localised, human-readable label.
 */
export function getBlockingKindLabel(
	kind: TemplateClusterBlockingEvidence['reason']['kind'],
	t: I18nValue['t'],
): string {
	const key = `views.templateClusterBlockingKind.${kind}`;
	const label = t(key);
	return label === key ? kind : label;
}
