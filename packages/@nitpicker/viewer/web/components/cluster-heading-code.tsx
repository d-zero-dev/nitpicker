import type { TemplateClusterSummary } from '@nitpicker/query';

import { buildClusterHeadingParts } from './build-cluster-heading-parts.js';
import { CodeList } from './code-list.js';

/** Props for {@link ClusterHeadingCode}. */
export interface ClusterHeadingCodeProps {
	/** The cluster whose derived heading to render. */
	cluster: TemplateClusterSummary;
}

/**
 * A cluster's derived heading (stylesheet file names, directories, or the
 * raw template key) with every identifier set in `<code>`, followed by the
 * sibling-disambiguating directory when the cluster has one. Text-for-text
 * the same as `buildClusterHeading`'s heading.
 * @param props - The cluster.
 * @returns The inline heading run.
 * @example
 * <ClusterHeadingCode cluster={cluster} />
 */
export function ClusterHeadingCode(props: ClusterHeadingCodeProps) {
	const { identifiers, qualifier } = buildClusterHeadingParts(props.cluster);
	return (
		<>
			<CodeList items={identifiers} />
			{qualifier && (
				<>
					{' — '}
					<code>{qualifier}</code>
				</>
			)}
		</>
	);
}
