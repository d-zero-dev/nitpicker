import type { I18nValue } from '../types.js';
import type { TemplateClusterLandmarkSummary } from '@nitpicker/query';

/**
 * Lookup the localised label for a {@link TemplateClusterLandmarkSummary}'s
 * `type`.
 *
 * Kept under its own `views.landmarkType` bag rather than nested under
 * `views.templateClusters` — landmark type is a general DOM concept
 * (`@d-zero/page-cluster`'s `header`/`footer`/`nav`/`aside`/`form`/`search`),
 * not something specific to the template-clusters view, so a future view
 * that also needs this label reuses the same translations (mirroring how
 * `views.errorKind` is shared between Summary and Errors).
 * @param type - The landmark type to label.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The localised, human-readable label.
 */
export function getLandmarkTypeLabel(
	type: TemplateClusterLandmarkSummary['type'],
	t: I18nValue['t'],
): string {
	const key = `views.landmarkType.${type}`;
	const label = t(key);
	return label === key ? type : label;
}
