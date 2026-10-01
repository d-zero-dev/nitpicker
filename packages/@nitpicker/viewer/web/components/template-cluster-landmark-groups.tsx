import type { LandmarkClusterGroup } from '../types.js';

import { getLandmarkTypeLabel } from '../i18n/get-landmark-type-label.js';
import { useI18n } from '../i18n/use-i18n.js';
import { formatPercent } from '../utils/format-percent.js';

import { AppLink } from './app-link.js';
import { buildClusterHeading } from './build-cluster-heading.js';

/** Props for {@link TemplateClusterLandmarkGroups}. */
export interface TemplateClusterLandmarkGroupsProps {
	/** Groups from `groupClustersByLandmark`. */
	groups: readonly LandmarkClusterGroup[];
}

/**
 * One section per landmark type, each listing the clusters that carry that
 * page part (a cluster carrying several types is listed in each — intended,
 * see `groupClustersByLandmark`). Deliberately not `<details>`: the per-cluster
 * sections below are the only `<details>` on the view, which the viewer E2E
 * specs rely on to locate a cluster by its heading text.
 * @param props - The landmark groups to render.
 * @returns The grouped sections, or `null` when there are no groups.
 */
export function TemplateClusterLandmarkGroups(props: TemplateClusterLandmarkGroupsProps) {
	const { t } = useI18n();
	const { groups } = props;

	if (groups.length === 0) {
		return null;
	}

	return (
		<section>
			<h2>{t('views.templateClusters.byLandmark')}</h2>
			<p>{t('views.templateClusters.byLandmarkCaveat')}</p>
			{groups.map((group) => (
				<section key={group.type} aria-labelledby={`landmark-group-${group.type}`}>
					<h3 id={`landmark-group-${group.type}`}>
						{getLandmarkTypeLabel(group.type, t)} (
						{t('views.templateClusters.clusterCount', { count: group.entries.length })})
					</h3>
					<table>
						<thead>
							<tr>
								<th>{t('views.templateClusters.colCluster')}</th>
								<th>{t('views.templateClusters.landmarkColPages')}</th>
								<th>{t('views.templateClusters.landmarkColPresence')}</th>
								<th>{t('views.templateClusters.landmarkColChrome')}</th>
							</tr>
						</thead>
						<tbody>
							{group.entries.map(({ cluster, landmark }) => (
								<tr key={cluster.templateKey}>
									<td>
										<AppLink
											to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
											{buildClusterHeading(cluster).heading}
										</AppLink>
									</td>
									<td>{cluster.pageCount}</td>
									<td>{formatPercent(landmark.presenceRate)}</td>
									<td>{formatPercent(landmark.chromeRate)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			))}
		</section>
	);
}
