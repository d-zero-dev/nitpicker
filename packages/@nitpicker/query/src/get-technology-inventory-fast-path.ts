import type { TechnologyInventoryEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getTechnologyInventory } from './get-technology-inventory.js';
import { getViewerTechnologyInventory } from './get-viewer-technology-inventory.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches to `getViewerTechnologyInventory` (the `viewer_technology_summary`
 * read-model fast path) when current, else `getTechnologyInventory` (the
 * live `GROUP BY` aggregation) — same "is the read model current or not"
 * dispatch as `getSummaryFastPath`, needed identically by the viewer route,
 * the CLI `query technology-inventory` command, and the MCP
 * `get_technology_inventory` tool.
 * @param accessor - The archive accessor to query.
 * @returns Inventory entries sorted by page count desc, from whichever
 *   backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const inventory = await getTechnologyInventoryFastPath(accessor);
 */
export async function getTechnologyInventoryFastPath(
	accessor: ArchiveAccessor,
): Promise<TechnologyInventoryEntry[]> {
	return (await isViewerReadModelCurrent(accessor))
		? getViewerTechnologyInventory(accessor)
		: getTechnologyInventory(accessor);
}
