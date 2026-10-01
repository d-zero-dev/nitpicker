import { useMemo } from 'react';

import { useTemplateClusters } from '../api/use-template-clusters.js';
import { computeTemplateClusterOverview } from '../components/compute-template-cluster-overview.js';
import { groupClustersByLandmark } from '../components/group-clusters-by-landmark.js';
import { TemplateClusterItem } from '../components/template-cluster-item.js';
import { TemplateClusterLandmarkGroups } from '../components/template-cluster-landmark-groups.js';
import { TemplateClusterSummaryPanel } from '../components/template-cluster-summary-panel.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Template cluster analysis: a summary panel (totals, largest clusters, size
 * distribution, per-landmark aggregates), clusters grouped by the landmark
 * types (`header`/`footer`/...) they carry, then one collapsible section per
 * `page_templates.template_key` cluster, each showing page count, top
 * directories by page count, common stylesheet set computed from the
 * cluster's actual member pages, and (when captured) `@d-zero/page-cluster`'s
 * cluster-selection evidence — the raw key itself is an opaque blocking key
 * and is not human-readable (see `TemplateClusterSummary`'s JSDoc in
 * `@nitpicker/query`).
 * @returns The template clusters view element.
 */
export function TemplateClustersView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useTemplateClusters();
	const overview = useMemo(
		() => (data ? computeTemplateClusterOverview(data.clusters) : undefined),
		[data],
	);
	const landmarkGroups = useMemo(
		() => (data ? groupClustersByLandmark(data.clusters) : []),
		[data],
	);

	return (
		<div>
			<ViewHeader
				titleKey="views.templateClusters.title"
				descriptionKey="views.templateClusters.description"
			/>
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{data && !data.hasClassification && (
				<div className="state">
					<p>{t('views.templateClusters.notClassified')}</p>
					<pre>
						<code>{t('views.templateClusters.notClassifiedCommandHint')}</code>
					</pre>
				</div>
			)}
			{data && data.hasClassification && data.clusters.length === 0 && (
				<div className="state">{t('views.templateClusters.noClusters')}</div>
			)}
			{data && overview && data.hasClassification && data.clusters.length > 0 && (
				<>
					<TemplateClusterSummaryPanel overview={overview} />
					<TemplateClusterLandmarkGroups groups={landmarkGroups} />
					<h2>{t('views.templateClusters.allClusters')}</h2>
					{data.clusters.map((cluster) => (
						<TemplateClusterItem key={cluster.templateKey} cluster={cluster} />
					))}
				</>
			)}
		</div>
	);
}
