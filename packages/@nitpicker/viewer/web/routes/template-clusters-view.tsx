import { useTemplateClusters } from '../api/use-template-clusters.js';
import { TemplateClusterItem } from '../components/template-cluster-item.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Template cluster analysis: one collapsible section per
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
			{data &&
				data.hasClassification &&
				data.clusters.map((cluster) => (
					<TemplateClusterItem key={cluster.templateKey} cluster={cluster} />
				))}
		</div>
	);
}
