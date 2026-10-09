import type { TemplateClusterSummary } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';
import { buildClusterHeadingParts } from './build-cluster-heading-parts.js';
import { ClusterDirectoryDistributionList } from './cluster-directory-distribution-list.js';
import { ClusterHeadingCode } from './cluster-heading-code.js';
import { ClusterName } from './cluster-name.js';
import { ClusterReasonSection } from './cluster-reason-section.js';
import { ClusterStylesheetUrlList } from './cluster-stylesheet-url-list.js';
import { computeClusterOtherPageCount } from './compute-cluster-other-page-count.js';
import { PropertyList } from './property-list.js';

/**
 * How many related paths the card header names. The full distribution
 * (top-N directories with counts) stays in the details beneath, so the
 * header never grows with a cluster's spread.
 */
const MAX_RELATED_PATHS_IN_HEADER = 3;

/** Props for {@link TemplateClusterItem}. */
export interface TemplateClusterItemProps {
	/** The cluster to render as one card. */
	cluster: TemplateClusterSummary;
}

/**
 * One `page_templates.template_key` cluster as a card: the cluster's name
 * (`ClusterName`) as an `<h3>`, its page count and leading related paths
 * as header property cards, and a link to its pages. Everything longer —
 * the member-derived stylesheet/directory hint (its own row only when the
 * name is a label, since it is the heading otherwise), top directories by
 * page count, the common stylesheet set computed from the cluster's actual
 * member pages, the raw template key and, when captured,
 * page-cluster's cluster-selection evidence — sits in a
 * `<details>` so a page of clusters scans by heading.
 * @param props - The cluster to render.
 * @returns The `<section>` element for this cluster.
 */
export function TemplateClusterItem(props: TemplateClusterItemProps) {
	const { t } = useI18n();
	const { cluster } = props;
	const { source } = buildClusterHeadingParts(cluster);
	const title =
		source === 'distinctive'
			? t('views.templateClusters.distinctiveCssCaveat')
			: source === 'common'
				? t('views.templateClusters.commonCssCaveat')
				: undefined;
	const headingId = `template-cluster-${encodeURIComponent(cluster.templateKey)}`;

	return (
		<section className="cluster-card" aria-labelledby={headingId}>
			<h3 id={headingId} title={cluster.label ? undefined : title}>
				<ClusterName cluster={cluster} />
			</h3>
			<PropertyList
				items={[
					{ label: t('views.templateClusters.colPages'), value: cluster.pageCount },
					{
						label: t('views.templateClusters.relatedPaths'),
						value:
							cluster.commonDirectories.length === 0 ? (
								'—'
							) : (
								<ul className="chip-list">
									{cluster.commonDirectories
										.slice(0, MAX_RELATED_PATHS_IN_HEADER)
										.map((entry) => (
											<li key={entry.directory}>
												<code>{entry.directory}</code>
											</li>
										))}
								</ul>
							),
					},
				]}
			/>
			<details>
				<summary>{t('views.templateClusters.clusterDetails')}</summary>
				<dl className="detail-grid">
					{cluster.label && (
						<>
							<dt>{t('views.templateClusters.memberHint')}</dt>
							<dd title={title}>
								<ClusterHeadingCode cluster={cluster} />
							</dd>
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
			</details>
			<p>
				<AppLink to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
					{t('views.templateClusters.viewPages')}
				</AppLink>
			</p>
		</section>
	);
}
