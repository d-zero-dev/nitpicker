import type { ClusterBlockGroup } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { listClusterBlocks } from './list-cluster-blocks.js';

/**
 * Groups clusters by the `@d-zero/page-cluster` Pass-0 blocks they drew
 * pages from (`listClusterBlocks`).
 *
 * A cluster Stage B merged across blocks is listed under **each** of its
 * source blocks — on purpose: a reader looking at one block must see every
 * cluster that took pages from it, and `reason.blocking` is the only place
 * the merge is recorded (the `templateKey` names just the seed block).
 * Every other cluster appears exactly once. Consequently a group's
 * `pageCount` counts a merged cluster's pages in each of its blocks, so the
 * sum over groups can exceed the archive's classified page total.
 *
 * Groups are sorted by `pageCount` descending, then block key ascending for
 * a stable order between equal-sized blocks; clusters within a group by
 * page count descending.
 * @param clusters - Every cluster from `useTemplateClusters`.
 * @returns One group per distinct block key.
 * @example
 * ```ts
 * const groups = groupClustersByBlock(data.clusters);
 * groups[0]?.block.blockKey; // the block holding the most pages
 * ```
 */
export function groupClustersByBlock(
	clusters: readonly TemplateClusterSummary[],
): ClusterBlockGroup[] {
	const groups = new Map<string, ClusterBlockGroup>();
	for (const cluster of clusters) {
		for (const block of listClusterBlocks(cluster)) {
			const group = groups.get(block.blockKey);
			if (group) {
				group.clusters.push(cluster);
				group.pageCount += cluster.pageCount;
			} else {
				groups.set(block.blockKey, {
					block,
					clusters: [cluster],
					pageCount: cluster.pageCount,
				});
			}
		}
	}
	const sorted = [...groups.values()].toSorted(
		(a, b) =>
			b.pageCount - a.pageCount || a.block.blockKey.localeCompare(b.block.blockKey),
	);
	for (const group of sorted) {
		group.clusters.sort((a, b) => b.pageCount - a.pageCount);
	}
	return sorted;
}
