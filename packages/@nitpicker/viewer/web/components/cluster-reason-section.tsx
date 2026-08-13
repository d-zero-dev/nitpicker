import type { TemplateClusterSummary } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { ClusterBlockingEvidenceList } from './cluster-blocking-evidence-list.js';
import { ClusterLandmarkTable } from './cluster-landmark-table.js';
import { ClusterSiblingList } from './cluster-sibling-list.js';
import { ClusterStructuralCoreTokenList } from './cluster-structural-core-token-list.js';
import { ClusterStylesheetUrlList } from './cluster-stylesheet-url-list.js';

/** Props for {@link ClusterReasonSection}. */
export interface ClusterReasonSectionProps {
	/** The cluster whose reason (or absence of one) to render. */
	cluster: TemplateClusterSummary;
}

/**
 * Renders one cluster's `@d-zero/page-cluster` cluster-selection evidence
 * (blocking reason, common DOM structure tokens, common landmarks, sibling
 * clusters), or a "not captured" notice when `cluster.reason` is `null`.
 * @param props - The cluster whose reason to render.
 * @returns The reason section element.
 */
export function ClusterReasonSection(props: ClusterReasonSectionProps) {
	const { t } = useI18n();
	const { reason } = props.cluster;

	if (!reason) {
		return (
			<div className="state">
				<p>{t('views.templateClusters.noReason')}</p>
				<pre>
					<code>{t('views.templateClusters.noReasonCommandHint')}</code>
				</pre>
			</div>
		);
	}

	const hiddenStructuralCoreCount =
		reason.structuralCoreTokenCount - reason.structuralCoreTokens.length;

	return (
		<dl className="detail-grid">
			<ClusterBlockingEvidenceList blocking={reason.blocking} />
			<ClusterStylesheetUrlList
				titleKey="views.templateClusters.distinctiveStylesheets"
				urls={reason.distinctiveStylesheetUrls}
				caveatKey="views.templateClusters.distinctiveCssCaveat"
			/>
			<ClusterStructuralCoreTokenList
				tokens={reason.structuralCoreTokens}
				hiddenCount={hiddenStructuralCoreCount}
			/>
			<ClusterLandmarkTable landmarks={reason.landmarks} />
			<ClusterSiblingList siblingClusterKeys={reason.siblingClusterKeys} />
		</dl>
	);
}
