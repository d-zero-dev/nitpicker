import type { TemplateClusterSummary } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';
import { buildClusterHeading } from './build-cluster-heading.js';
import { ClusterDirectoryDistributionList } from './cluster-directory-distribution-list.js';
import { ClusterReasonSection } from './cluster-reason-section.js';
import { ClusterStylesheetUrlList } from './cluster-stylesheet-url-list.js';
import { computeClusterOtherPageCount } from './compute-cluster-other-page-count.js';
import { formatClusterName } from './format-cluster-name.js';

/** Props for {@link TemplateClusterItem}. */
export interface TemplateClusterItemProps {
	/** The cluster to render as one collapsible `<details>` section. */
	cluster: TemplateClusterSummary;
}

/**
 * One `page_templates.template_key` cluster's collapsible section, headed
 * by the cluster's name (`formatClusterName`): page count, the
 * member-derived stylesheet/directory hint (shown as its own row only when
 * the name is a label, since it is the heading otherwise), top directories
 * by page count, common stylesheet set computed from the cluster's actual
 * member pages, and (when captured) `@d-zero/page-cluster`'s
 * cluster-selection evidence.
 * @param props - The cluster to render.
 * @returns The `<details>` element for this cluster.
 */
export function TemplateClusterItem(props: TemplateClusterItemProps) {
	const { t } = useI18n();
	const { cluster } = props;
	const { heading, source } = buildClusterHeading(cluster);
	const title =
		source === 'distinctive'
			? t('views.templateClusters.distinctiveCssCaveat')
			: source === 'common'
				? t('views.templateClusters.commonCssCaveat')
				: undefined;

	return (
		<details>
			<summary title={cluster.label ? undefined : title}>
				{formatClusterName(cluster, t)} (
				{t('views.templateClusters.pageCount', { count: cluster.pageCount })})
			</summary>
			<dl className="detail-grid">
				{cluster.label && (
					<>
						<dt>{t('views.templateClusters.memberHint')}</dt>
						<dd title={title}>{heading}</dd>
					</>
				)}
				<dt>{t('views.templateClusters.commonDirectories')}</dt>
				<dd>
					<ClusterDirectoryDistributionList
						directories={cluster.commonDirectories}
						otherPageCount={computeClusterOtherPageCount(cluster)}
					/>
				</dd>
				<ClusterStylesheetUrlList
					titleKey="views.templateClusters.commonStylesheets"
					urls={cluster.commonStylesheetUrls}
					caveatKey="views.templateClusters.commonCssCaveat"
					emptyLabelKey="views.templateClusters.noCommonCss"
				/>
				<dt>{t('views.templateClusters.rawKey')}</dt>
				<dd>
					<code>{cluster.templateKey}</code>
				</dd>
			</dl>
			<ClusterReasonSection cluster={cluster} />
			<AppLink to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
				{t('views.templateClusters.viewPages')}
			</AppLink>
		</details>
	);
}
