import type {
	ClusterBlockKind,
	ClusterBlockKindOverview,
	ClusterSizeBucket,
	ClusterSizeBucketKey,
	TemplateClusterOverview,
} from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { groupClustersByBlock } from './group-clusters-by-block.js';
import { listClusterBlocks } from './list-cluster-blocks.js';

const BLOCK_KIND_ORDER: readonly ClusterBlockKind[] = [
	'css',
	'path',
	'orphanMerge',
	'unknown',
];

const SIZE_BUCKET_KEYS: readonly ClusterSizeBucketKey[] = [
	'single',
	'small',
	'medium',
	'large',
];

/**
 * Maps a cluster's page count to its size-distribution bucket.
 * @param pageCount - The cluster's page count.
 * @returns The bucket (`1` / `2–5` / `6–20` / `21+` pages) containing it.
 */
function toSizeBucketKey(pageCount: number): ClusterSizeBucketKey {
	if (pageCount <= 1) {
		return 'single';
	}
	if (pageCount <= 5) {
		return 'small';
	}
	if (pageCount <= 20) {
		return 'medium';
	}
	return 'large';
}

/**
 * Aggregates the cluster list into the figures shown in the summary panel at
 * the top of the template clusters view: totals, the largest clusters, the
 * size distribution (`1` / `2–5` / `6–20` / `21+` pages), and how the
 * clusters divide into `@d-zero/page-cluster` Pass-0 blocks (block count
 * and a per-kind breakdown — see `groupClustersByBlock`).
 *
 * Derived entirely from the `GET /api/template-clusters` payload — no extra
 * API field. Notably there is no "unclassified page count": `--templates`
 * assigns a key to every internal HTML page, and the payload carries no
 * archive-wide page total to compare against.
 * @param clusters - Every cluster from `useTemplateClusters`.
 * @param topN - How many of the largest clusters to include. Defaults to 5.
 * @returns The aggregated overview.
 * @example
 * ```ts
 * const overview = computeTemplateClusterOverview(data.clusters);
 * overview.totalPageCount; // sum of every cluster's pageCount
 * ```
 */
export function computeTemplateClusterOverview(
	clusters: readonly TemplateClusterSummary[],
	topN = 5,
): TemplateClusterOverview {
	const buckets = new Map<ClusterSizeBucketKey, ClusterSizeBucket>(
		SIZE_BUCKET_KEYS.map((key) => [key, { key, clusterCount: 0, pageCount: 0 }]),
	);
	let totalPageCount = 0;
	let singletonClusterCount = 0;
	for (const cluster of clusters) {
		totalPageCount += cluster.pageCount;
		if (cluster.pageCount <= 1) {
			singletonClusterCount += 1;
		}
		const bucket = buckets.get(toSizeBucketKey(cluster.pageCount))!;
		bucket.clusterCount += 1;
		bucket.pageCount += cluster.pageCount;
	}

	const blockGroups = groupClustersByBlock(clusters);
	const kinds = new Map<ClusterBlockKind, ClusterBlockKindOverview>(
		BLOCK_KIND_ORDER.map((kind) => [
			kind,
			{ kind, blockCount: 0, clusterCount: 0, pageCount: 0 },
		]),
	);
	for (const group of blockGroups) {
		kinds.get(group.block.kind)!.blockCount += 1;
	}
	// Clusters and pages are attributed to the first block only, so these
	// columns sum to `clusterCount` / `totalPageCount` even though a cluster
	// merged across blocks is listed under each of them in `blockGroups`.
	for (const cluster of clusters) {
		const row = kinds.get(listClusterBlocks(cluster)[0]!.kind)!;
		row.clusterCount += 1;
		row.pageCount += cluster.pageCount;
	}

	return {
		clusterCount: clusters.length,
		totalPageCount,
		singletonClusterCount,
		topClusters: clusters.toSorted((a, b) => b.pageCount - a.pageCount).slice(0, topN),
		sizeBuckets: [...buckets.values()],
		blockGroups,
		blockCount: blockGroups.length,
		blockKinds: [...kinds.values()].filter((row) => row.blockCount > 0),
	};
}
