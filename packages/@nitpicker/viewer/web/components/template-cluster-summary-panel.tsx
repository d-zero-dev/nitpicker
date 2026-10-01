import type { ClusterSizeBucketKey, TemplateClusterOverview } from '../types.js';

import { getBlockingKindLabel } from '../i18n/get-blocking-kind-label.js';
import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';
import { formatClusterName } from './format-cluster-name.js';
import { SummaryCard } from './summary-card.js';

/** Props for {@link TemplateClusterSummaryPanel}. */
export interface TemplateClusterSummaryPanelProps {
	/** Aggregates from `computeTemplateClusterOverview`. */
	overview: TemplateClusterOverview;
}

const SIZE_BUCKET_LABEL_KEYS: Record<ClusterSizeBucketKey, string> = {
	single: 'views.templateClusters.sizeBucketSingle',
	small: 'views.templateClusters.sizeBucketSmall',
	medium: 'views.templateClusters.sizeBucketMedium',
	large: 'views.templateClusters.sizeBucketLarge',
};

/**
 * Summary at the top of the template clusters view: headline counts, the
 * largest clusters, the cluster size distribution, and how the clusters
 * divide into `@d-zero/page-cluster` Pass-0 blocks by kind.
 * @param props - The precomputed overview.
 * @returns The summary section element.
 */
export function TemplateClusterSummaryPanel(props: TemplateClusterSummaryPanelProps) {
	const { t } = useI18n();
	const { overview } = props;

	return (
		<section>
			<div className="cards">
				<SummaryCard
					label={t('views.templateClusters.overviewClusters')}
					value={overview.clusterCount}
				/>
				<SummaryCard
					label={t('views.templateClusters.overviewPages')}
					value={overview.totalPageCount}
				/>
				<SummaryCard
					label={t('views.templateClusters.overviewSingletons')}
					value={overview.singletonClusterCount}
				/>
				<SummaryCard
					label={t('views.templateClusters.overviewBlocks')}
					value={overview.blockCount}
				/>
			</div>

			<h2>{t('views.templateClusters.topClusters')}</h2>
			<ol>
				{overview.topClusters.map((cluster) => (
					<li key={cluster.templateKey}>
						<AppLink to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
							{formatClusterName(cluster, t)}
						</AppLink>{' '}
						({t('views.templateClusters.pageCount', { count: cluster.pageCount })})
					</li>
				))}
			</ol>

			<h2>{t('views.templateClusters.sizeDistribution')}</h2>
			<div className="plain-table-scroll">
				<table className="plain-table">
					<thead>
						<tr>
							<th>{t('views.templateClusters.sizeColRange')}</th>
							<th>{t('views.templateClusters.colClusters')}</th>
							<th>{t('views.templateClusters.colPages')}</th>
						</tr>
					</thead>
					<tbody>
						{overview.sizeBuckets.map((bucket) => (
							<tr key={bucket.key}>
								<td>{t(SIZE_BUCKET_LABEL_KEYS[bucket.key])}</td>
								<td>{bucket.clusterCount}</td>
								<td>{bucket.pageCount}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<h2>{t('views.templateClusters.blockOverview')}</h2>
			<p className="view-description">
				{t('views.templateClusters.blockOverviewCaveat')}
			</p>
			<div className="plain-table-scroll">
				<table className="plain-table">
					<thead>
						<tr>
							<th>{t('views.templateClusters.colBlockKind')}</th>
							<th>{t('views.templateClusters.colBlocks')}</th>
							<th>{t('views.templateClusters.colClusters')}</th>
							<th>{t('views.templateClusters.colPages')}</th>
						</tr>
					</thead>
					<tbody>
						{overview.blockKinds.map((row) => (
							<tr key={row.kind}>
								<td>{getBlockingKindLabel(row.kind, t)}</td>
								<td>{row.blockCount}</td>
								<td>{row.clusterCount}</td>
								<td>{row.pageCount}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
