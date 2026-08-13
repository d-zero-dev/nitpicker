import type { TechnologyInventoryEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./get-technology-inventory.js', () => ({ getTechnologyInventory: vi.fn() }));
vi.mock('./get-viewer-technology-inventory.js', () => ({
	getViewerTechnologyInventory: vi.fn(),
}));
vi.mock('./viewer-read-model/is-viewer-read-model-current.js', () => ({
	isViewerReadModelCurrent: vi.fn(),
}));

const { getTechnologyInventory } = await import('./get-technology-inventory.js');
const { getViewerTechnologyInventory } =
	await import('./get-viewer-technology-inventory.js');
const { isViewerReadModelCurrent } =
	await import('./viewer-read-model/is-viewer-read-model-current.js');
const { getTechnologyInventoryFastPath } =
	await import('./get-technology-inventory-fast-path.js');

/**
 * Minimal `TechnologyInventoryEntry[]` literal distinguishing which backend
 * answered via `technology`.
 * @param technology - Sentinel field to distinguish results across tests.
 */
function makeEntries(technology: string): TechnologyInventoryEntry[] {
	return [{ technology, category: null, pageCount: 1, avgConfidence: 100 }];
}

const accessor = {} as ArchiveAccessor;

afterEach(() => {
	vi.clearAllMocks();
});

describe('getTechnologyInventoryFastPath', () => {
	it('reads from the viewer_technology_summary read model when it is current', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(getViewerTechnologyInventory).mockResolvedValue(makeEntries('fast-path'));

		const result = await getTechnologyInventoryFastPath(accessor);

		expect(result[0]?.technology).toBe('fast-path');
		expect(getViewerTechnologyInventory).toHaveBeenCalledWith(accessor);
		expect(getTechnologyInventory).not.toHaveBeenCalled();
	});

	it('falls back to the live GROUP BY aggregation when the read model is stale or absent', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(getTechnologyInventory).mockResolvedValue(makeEntries('live'));

		const result = await getTechnologyInventoryFastPath(accessor);

		expect(result[0]?.technology).toBe('live');
		expect(getTechnologyInventory).toHaveBeenCalledWith(accessor);
		expect(getViewerTechnologyInventory).not.toHaveBeenCalled();
	});
});
