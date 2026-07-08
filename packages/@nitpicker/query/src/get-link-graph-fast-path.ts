import type { GetLinkGraphOptions, LinkGraph } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getLinkGraph } from './get-link-graph.js';
import { getViewerLinkGraph } from './get-viewer-link-graph.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches `/api/graph` reads to the precomputed graph tables when the
 * viewer read model is current, otherwise falls back to the legacy live
 * anchor join.
 * @param accessor
 * @param options
 */
export async function getLinkGraphFastPath(
	accessor: ArchiveAccessor,
	options: GetLinkGraphOptions = {},
): Promise<LinkGraph> {
	return (await isViewerReadModelCurrent(accessor))
		? getViewerLinkGraph(accessor, options)
		: getLinkGraph(accessor, options);
}
