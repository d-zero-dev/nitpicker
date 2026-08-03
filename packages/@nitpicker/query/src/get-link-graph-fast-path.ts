import type { GetLinkGraphOptions, LinkGraph } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getLinkGraph } from './get-link-graph.js';
import { getViewerLinkGraph } from './get-viewer-link-graph.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches link-graph reads to `getViewerLinkGraph` (the precomputed
 * `viewer_graph_nodes`/`viewer_graph_edges` read-model fast path) when the
 * read model is current, otherwise falls back to `getLinkGraph` (the live
 * live anchor join). `options` passes through unchanged to whichever backend
 * answers — both implement the same contract, so the choice is purely "is
 * the read model current or not".
 * @param accessor - The archive accessor to query.
 * @param options - Node-cap options (`limit` bounds the node count; edges
 *   are restricted to the retained nodes).
 * @returns The internal link graph, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const graph = await getLinkGraphFastPath(accessor, { limit: 500 });
 */
export async function getLinkGraphFastPath(
	accessor: ArchiveAccessor,
	options: GetLinkGraphOptions = {},
): Promise<LinkGraph> {
	return (await isViewerReadModelCurrent(accessor))
		? getViewerLinkGraph(accessor, options)
		: getLinkGraph(accessor, options);
}
