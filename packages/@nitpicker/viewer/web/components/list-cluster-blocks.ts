import type { ClusterBlockRef } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { parseTemplateKeyBlock } from './parse-template-key-block.js';

/**
 * Lists every `@d-zero/page-cluster` Pass-0 block a cluster drew pages
 * from.
 *
 * `reason.blocking` is the authoritative list: a final cluster that Stage B
 * merged across blocks carries one entry per source block, whereas the
 * `templateKey` names only the block the merge was seeded from. The
 * template key is the fallback for a cluster whose reason was never
 * captured, and — as a last resort for a template key that does not parse —
 * the raw key itself as an `unknown` block, so every cluster has at least
 * one block.
 * @param cluster - The cluster to list blocks for.
 * @returns The blocks, in `reason.blocking` order; never empty.
 * @example
 * ```ts
 * listClusterBlocks(cluster).map((b) => b.blockKey);
 * // => ['orphan-merge:events', 'orphan-merge:interviews']
 * ```
 */
export function listClusterBlocks(cluster: TemplateClusterSummary): ClusterBlockRef[] {
	const blocking = cluster.reason?.blocking ?? [];
	if (blocking.length > 0) {
		return blocking.map((evidence) => ({
			blockKey: evidence.blockKey,
			kind: evidence.reason.kind,
		}));
	}
	return [
		parseTemplateKeyBlock(cluster.templateKey) ?? {
			blockKey: cluster.templateKey,
			kind: 'unknown',
		},
	];
}
