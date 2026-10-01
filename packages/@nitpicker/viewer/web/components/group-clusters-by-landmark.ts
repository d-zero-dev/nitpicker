import type { LandmarkClusterGroup } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { LANDMARK_TYPE_ORDER } from './landmark-type-order.js';

/**
 * Groups clusters by the landmark types (`header`/`footer`/`nav`/`aside`/
 * `form`/`search`) their `reason.landmarks` carries.
 *
 * A cluster carrying several landmark types appears once in each matching
 * group — the point of the grouping is "which clusters share this part", so
 * duplicates across groups are intended. Clusters without a `reason` (or
 * with an empty `landmarks`) appear in no group. Groups with no entries are
 * omitted; groups follow the stable landmark type order, entries are sorted
 * by `pageCount` descending.
 * @param clusters - Every cluster from `useTemplateClusters`.
 * @returns One group per landmark type that at least one cluster carries.
 * @example
 * ```ts
 * const groups = groupClustersByLandmark(data.clusters);
 * groups[0]?.type; // e.g. 'header'
 * ```
 */
export function groupClustersByLandmark(
	clusters: readonly TemplateClusterSummary[],
): LandmarkClusterGroup[] {
	const groups: LandmarkClusterGroup[] = [];
	for (const type of LANDMARK_TYPE_ORDER) {
		const entries: LandmarkClusterGroup['entries'] = [];
		for (const cluster of clusters) {
			const landmark = cluster.reason?.landmarks.find((l) => l.type === type);
			if (landmark) {
				entries.push({ cluster, landmark });
			}
		}
		if (entries.length > 0) {
			entries.sort((a, b) => b.cluster.pageCount - a.cluster.pageCount);
			groups.push({ type, entries });
		}
	}
	return groups;
}
