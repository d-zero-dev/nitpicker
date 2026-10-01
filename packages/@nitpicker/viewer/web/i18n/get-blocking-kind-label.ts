import type { ClusterBlockKind, I18nValue } from '../types.js';

/**
 * Lookup the localised label for a `TemplateClusterBlockingEvidence`'s
 * `reason.kind`, or for the {@link ClusterBlockKind} parsed out of a template
 * key (the same values plus `unknown`).
 *
 * Same `views.<enum>.<value>` + raw-value-fallback pattern as
 * `getErrorKindLabel`/`getAttributionLabel` — a new blocking kind introduced
 * upstream (`@d-zero/page-cluster`) does not display blank in an older
 * viewer build.
 * @param kind - The blocking reason kind to label.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The localised, human-readable label.
 */
export function getBlockingKindLabel(kind: ClusterBlockKind, t: I18nValue['t']): string {
	const key = `views.templateClusterBlockingKind.${kind}`;
	const label = t(key);
	return label === key ? kind : label;
}
