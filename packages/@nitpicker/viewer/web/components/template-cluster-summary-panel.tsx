import type { ClusterSizeBucketKey, TemplateClusterOverview } from '../types.js';

import { getLandmarkTypeLabel } from '../i18n/get-landmark-type-label.js';
import { useI18n } from '../i18n/use-i18n.js';
import { formatPercent } from '../utils/format-percent.js';

import { AppLink } from './app-link.js';
import { buildClusterHeading } from './build-cluster-heading.js';
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
 * largest clusters, the cluster size distribution, and how common each page
 * part (`header`/`footer`/`nav`/`aside`/`form`/`search`) is across clusters.
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
			</div>

			<h2>{t('views.templateClusters.topClusters')}</h2>
			<ol>
				{overview.topClusters.map((cluster) => (
					<li key={cluster.templateKey}>
						<AppLink to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
							{buildClusterHeading(cluster).heading}
						</AppLink>{' '}
						({t('views.templateClusters.pageCount', { count: cluster.pageCount })})
					</li>
				))}
			</ol>

			<h2>{t('views.templateClusters.sizeDistribution')}</h2>
			<table>
				<thead>
					<tr>
						<th>{t('views.templateClusters.sizeColRange')}</th>
						<th>{t('views.templateClusters.colClusters')}</th>
						<th>{t('views.templateClusters.landmarkColPages')}</th>
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

			{overview.landmarks.length > 0 && (
				<>
					<h2>{t('views.templateClusters.landmarkOverview')}</h2>
					<p>{t('views.templateClusters.landmarkOverviewCaveat')}</p>
					<table>
						<thead>
							<tr>
								<th>{t('views.templateClusters.landmarkColType')}</th>
								<th>{t('views.templateClusters.colClusters')}</th>
								<th>{t('views.templateClusters.colAveragePresence')}</th>
							</tr>
						</thead>
						<tbody>
							{overview.landmarks.map((landmark) => (
								<tr key={landmark.type}>
									<td>{getLandmarkTypeLabel(landmark.type, t)}</td>
									<td>{landmark.clusterCount}</td>
									<td>{formatPercent(landmark.averagePresenceRate)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
		</section>
	);
}
