import type { ClusterHeadingSource } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

/**
 * Builds the human-readable heading for one cluster's section, plus which
 * source it came from (the caller uses this to pick the matching `<summary>`
 * caveat tooltip, so the priority order lives in exactly one place instead
 * of being re-derived independently there).
 *
 * Priority: the reason's distinctive stylesheet filenames (the strongest
 * signal — the exact CSS set `@d-zero/page-cluster` used to blocking-key
 * this cluster, after site-wide-chrome and non-first-party filtering),
 * falling back to the raw common-stylesheet-intersection filenames, then
 * the top directories by page count, and finally the raw template key when
 * nothing else yields anything (an unparseable-URL edge case — see
 * `computeDirectoryDistribution`'s defensive skip).
 *
 * Both stylesheet-based sources can collide across sibling clusters that
 * split off the same blocking group (`reason.siblingClusterKeys`
 * non-empty): `distinctiveStylesheetHrefs` is a **blocking group**'s
 * attribute, not a per-final-cluster one, so it's identical by
 * construction across siblings; `commonStylesheetFileNames` isn't
 * guaranteed identical the same way, but a site-wide-shared stylesheet
 * landing in the raw intersection can still coincide across siblings in
 * practice. Both branches append the top directory to disambiguate when
 * siblings exist.
 *
 * `commonStylesheetFileNames` (dedup'd, filename-only) is precomputed
 * server-side by `@nitpicker/query`'s `computeStylesheetFileNames` rather
 * than derived here — see that function's own JSDoc for why the underlying
 * URL parser can't run in the browser build.
 * @param cluster - The template cluster to build a heading for.
 * @returns The heading text and which source it was drawn from.
 * @example
 * ```ts
 * const { heading, source } = buildClusterHeading(cluster);
 * ```
 */
export function buildClusterHeading(cluster: TemplateClusterSummary): {
	heading: string;
	source: ClusterHeadingSource;
} {
	const hasSiblings = (cluster.reason?.siblingClusterKeys.length ?? 0) > 0;
	const disambiguated = (base: string) =>
		hasSiblings && cluster.commonDirectories.length > 0
			? `${base} — ${cluster.commonDirectories[0]!.directory}`
			: base;

	const distinctiveNames = cluster.reason?.distinctiveStylesheetFileNames ?? [];
	if (distinctiveNames.length > 0) {
		return { heading: disambiguated(distinctiveNames.join(', ')), source: 'distinctive' };
	}
	if (cluster.commonStylesheetFileNames.length > 0) {
		return {
			heading: disambiguated(cluster.commonStylesheetFileNames.join(', ')),
			source: 'common',
		};
	}
	if (cluster.commonDirectories.length > 0) {
		return {
			heading: cluster.commonDirectories.map((entry) => entry.directory).join(', '),
			source: 'directory',
		};
	}
	return { heading: cluster.templateKey, source: 'raw' };
}
