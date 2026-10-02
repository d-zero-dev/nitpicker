import type { ClusterHeadingParts } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

/**
 * Splits a cluster's derived heading into its literal identifiers and an
 * optional sibling-disambiguating qualifier — the structured form behind
 * `buildClusterHeading`'s text, which exists so the view can set each
 * identifier in `<code>`.
 *
 * Priority (the single place it lives; `buildClusterHeading` is derived
 * from this): the reason's distinctive stylesheet file names, then the raw
 * common-stylesheet-intersection file names, then the top directories by
 * page count, and finally the raw template key. Both stylesheet-based
 * sources carry the top directory as `qualifier` when the cluster has
 * siblings split off the same blocking group, because their file names can
 * coincide across those siblings.
 * @param cluster - The template cluster to split a heading for.
 * @returns The identifiers, the optional qualifier and the source.
 * @example
 * ```ts
 * buildClusterHeadingParts(cluster);
 * // => { identifiers: ['product.css'], qualifier: '/products/', source: 'distinctive' }
 * ```
 */
export function buildClusterHeadingParts(
	cluster: TemplateClusterSummary,
): ClusterHeadingParts {
	const hasSiblings = (cluster.reason?.siblingClusterKeys.length ?? 0) > 0;
	const qualifier =
		hasSiblings && cluster.commonDirectories.length > 0
			? cluster.commonDirectories[0]!.directory
			: undefined;

	const distinctiveNames = cluster.reason?.distinctiveStylesheetFileNames ?? [];
	if (distinctiveNames.length > 0) {
		return { identifiers: distinctiveNames, qualifier, source: 'distinctive' };
	}
	if (cluster.commonStylesheetFileNames.length > 0) {
		return {
			identifiers: cluster.commonStylesheetFileNames,
			qualifier,
			source: 'common',
		};
	}
	if (cluster.commonDirectories.length > 0) {
		return {
			identifiers: cluster.commonDirectories.map((entry) => entry.directory),
			source: 'directory',
		};
	}
	return { identifiers: [cluster.templateKey], source: 'raw' };
}
