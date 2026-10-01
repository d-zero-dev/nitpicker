import type { TemplateClusterLandmarkSummary } from '@nitpicker/query';

import { getLandmarkTypeLabel } from '../i18n/get-landmark-type-label.js';
import { useI18n } from '../i18n/use-i18n.js';
import { formatPercent } from '../utils/format-percent.js';

/** Props for {@link ClusterLandmarkTable}. */
export interface ClusterLandmarkTableProps {
	/** Per-landmark-type commonality summaries (`reason.landmarks`). */
	landmarks: readonly TemplateClusterLandmarkSummary[];
}

/**
 * Renders one cluster's landmark commonality table — how often each of
 * `header`/`footer`/`nav`/`aside`/`form`/`search` appears across the
 * block's member pages, and how much of that presence is shared chrome vs.
 * page-specific content.
 *
 * Uses a `<table>` rather than the `<ul><li>` shape of its sibling
 * cluster-reason components — kept as its own component anyway, matching
 * `ClusterReasonSection`'s per-data-type extraction of every other blocking
 * detail.
 * @param props - The landmark summaries to render.
 * @returns The `<dt>`/`<dd>` pair element, or `null` when `landmarks` is empty.
 */
export function ClusterLandmarkTable(props: ClusterLandmarkTableProps) {
	const { t } = useI18n();
	const { landmarks } = props;

	if (landmarks.length === 0) {
		return null;
	}

	return (
		<>
			<dt>{t('views.templateClusters.landmarks')}</dt>
			<dd>
				<div className="plain-table-scroll">
					<table className="plain-table">
						<thead>
							<tr>
								<th>{t('views.templateClusters.landmarkColType')}</th>
								<th className="plain-table-num">
									{t('views.templateClusters.landmarkColPresence')}
								</th>
								<th className="plain-table-num">
									{t('views.templateClusters.landmarkColChrome')}
								</th>
								<th className="plain-table-num">
									{t('views.templateClusters.landmarkColPages')}
								</th>
							</tr>
						</thead>
						<tbody>
							{landmarks.map((landmark) => (
								<tr key={landmark.type}>
									<td>{getLandmarkTypeLabel(landmark.type, t)}</td>
									<td className="plain-table-num">
										{formatPercent(landmark.presenceRate)}
									</td>
									<td className="plain-table-num">
										{formatPercent(landmark.chromeRate)}
									</td>
									<td className="plain-table-num">{landmark.memberCountWithInstance}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</dd>
		</>
	);
}
