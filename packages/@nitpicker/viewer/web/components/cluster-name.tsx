import type { TemplateClusterSummary } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';
import { formatTemplateLabel } from '../utils/format-template-label.js';

import { ClusterHeadingCode } from './cluster-heading-code.js';

/** Props for {@link ClusterName}. */
export interface ClusterNameProps {
	/** The cluster to name. */
	cluster: TemplateClusterSummary;
}

/**
 * The name a cluster is shown under, as markup: its label
 * (`events template A`) as plain words when it has one — a name people say
 * — otherwise the derived stylesheet/directory/key heading with each
 * identifier in `<code>`.
 * @param props - The cluster.
 * @returns The inline name.
 * @example
 * <h3><ClusterName cluster={cluster} /></h3>
 */
export function ClusterName(props: ClusterNameProps) {
	const { t } = useI18n();
	const { cluster } = props;
	return cluster.label ? (
		<>{formatTemplateLabel(cluster.label, t)}</>
	) : (
		<ClusterHeadingCode cluster={cluster} />
	);
}
