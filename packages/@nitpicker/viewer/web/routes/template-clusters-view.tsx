import type { TemplateClusterSummary } from '@nitpicker/query';

import { Link } from 'react-router';

import { useTemplateClusters } from '../api/use-template-clusters.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Builds the human-readable heading for one cluster's section: the common
 * stylesheet filenames when there are any (the strongest signal for "what
 * this template is"), falling back to the common directory, and finally to
 * the raw template key when neither yields anything (an unparseable-URL edge
 * case — see `computeCommonDirectory`'s defensive skip).
 *
 * `commonStylesheetFileNames` (dedup'd, filename-only) is precomputed
 * server-side by `@nitpicker/query`'s `computeStylesheetFileNames` rather
 * than derived here — see that function's own JSDoc for why the underlying
 * URL parser can't run in the browser build.
 * @param cluster
 */
function clusterHeading(cluster: TemplateClusterSummary): string {
	if (cluster.commonStylesheetFileNames.length > 0) {
		return cluster.commonStylesheetFileNames.join(', ');
	}
	if (cluster.commonDirectories.length > 0) {
		return cluster.commonDirectories.join(', ');
	}
	return cluster.templateKey;
}

/**
 * Template cluster analysis: one collapsible section per
 * `page_templates.template_key` cluster, each showing page count, common
 * directory, and common stylesheet set computed from the cluster's actual
 * member pages — the raw key itself is an opaque blocking key and is not
 * human-readable (see `TemplateClusterSummary`'s JSDoc in `@nitpicker/query`).
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
					<details key={cluster.templateKey}>
						<summary
							title={
								cluster.commonStylesheetFileNames.length > 0
									? t('views.templateClusters.commonCssCaveat')
									: undefined
							}>
							{clusterHeading(cluster)} (
							{t('views.templateClusters.pageCount', { count: cluster.pageCount })})
						</summary>
						<dl className="detail-grid">
							<dt>{t('views.templateClusters.commonDirectories')}</dt>
							<dd>
								{cluster.commonDirectories.length > 0 ? (
									<ul>
										{cluster.commonDirectories.map((dir) => (
											<li key={dir}>{dir}</li>
										))}
									</ul>
								) : (
									'—'
								)}
							</dd>
							<dt>{t('views.templateClusters.commonStylesheets')}</dt>
							<dd>
								{cluster.commonStylesheetUrls.length > 0 ? (
									<>
										<ul>
											{cluster.commonStylesheetUrls.map((url) => (
												<li key={url}>{url}</li>
											))}
										</ul>
										<p className="view-description">
											{t('views.templateClusters.commonCssCaveat')}
										</p>
									</>
								) : (
									t('views.templateClusters.noCommonCss')
								)}
							</dd>
							<dt>{t('views.templateClusters.rawKey')}</dt>
							<dd>
								<code>{cluster.templateKey}</code>
							</dd>
						</dl>
						<Link to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
							{t('views.templateClusters.viewPages')}
						</Link>
					</details>
				))}
		</div>
	);
}
