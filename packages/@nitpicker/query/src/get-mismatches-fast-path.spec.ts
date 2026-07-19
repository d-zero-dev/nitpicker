import type { CursorPaginatedMismatchList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./find-mismatches.js', () => ({ findMismatches: vi.fn() }));
vi.mock('./list-viewer-mismatches.js', () => ({ listViewerMismatches: vi.fn() }));
vi.mock('./viewer-read-model/is-viewer-read-model-current.js', () => ({
	isViewerReadModelCurrent: vi.fn(),
}));

const { findMismatches } = await import('./find-mismatches.js');
const { listViewerMismatches } = await import('./list-viewer-mismatches.js');
const { isViewerReadModelCurrent } =
	await import('./viewer-read-model/is-viewer-read-model-current.js');
const { getMismatchesFastPath } = await import('./get-mismatches-fast-path.js');

/**
 * Minimal `CursorPaginatedMismatchList`-shaped literal — the dispatcher
 * treats the value opaquely, so an empty `items` array plus a sentinel
 * `total` is enough to tell which backend answered.
 * @param total - Identifying field to distinguish results across tests.
 * @returns A `CursorPaginatedMismatchList`-shaped object.
 */
function makeResult(total: number): CursorPaginatedMismatchList {
	return { items: [], total, offset: 0, limit: 100, nextCursor: null, prevCursor: null };
}

const accessor = {} as ArchiveAccessor;

afterEach(() => {
	vi.clearAllMocks();
});

describe('getMismatchesFastPath', () => {
	it('reads from the viewer_mismatches read model when it is current and no wide-table-only filter is set', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerMismatches).mockResolvedValue(makeResult(1));

		const result = await getMismatchesFastPath(accessor, 'canonical', { limit: 50 });

		expect(result.total).toBe(1);
		expect(listViewerMismatches).toHaveBeenCalledWith(accessor, {
			type: 'canonical',
			sortOrder: undefined,
			limit: 50,
			cursor: undefined,
			direction: undefined,
			offset: undefined,
		});
		expect(findMismatches).not.toHaveBeenCalled();
	});

	it('forces the legacy path when sortBy is set, even if the read model is current', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(findMismatches).mockResolvedValue({
			items: [],
			total: 1,
			limit: 100,
			offset: 0,
		});

		await getMismatchesFastPath(accessor, 'canonical', { sortBy: 'actual' });

		expect(findMismatches).toHaveBeenCalledWith(accessor, 'canonical', {
			limit: undefined,
			offset: undefined,
			urlPattern: undefined,
			sortBy: 'actual',
			sortOrder: undefined,
		});
		expect(listViewerMismatches).not.toHaveBeenCalled();
	});

	it('forces the legacy path when urlPattern is set, even if the read model is current', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(findMismatches).mockResolvedValue({
			items: [],
			total: 2,
			limit: 100,
			offset: 0,
		});

		await getMismatchesFastPath(accessor, 'canonical', { urlPattern: '%foo%' });

		expect(findMismatches).toHaveBeenCalledWith(
			accessor,
			'canonical',
			expect.objectContaining({ urlPattern: '%foo%' }),
		);
		expect(listViewerMismatches).not.toHaveBeenCalled();
	});

	it('forwards cursor/direction to the fast path', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerMismatches).mockResolvedValue(makeResult(1));

		await getMismatchesFastPath(accessor, 'og:title', {
			cursor: 'opaque-cursor',
			direction: 'prev',
		});

		expect(listViewerMismatches).toHaveBeenCalledWith(
			accessor,
			expect.objectContaining({ cursor: 'opaque-cursor', direction: 'prev' }),
		);
	});

	it('falls back to the legacy path when the read model is stale or absent', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(findMismatches).mockResolvedValue({
			items: [],
			total: 3,
			limit: 100,
			offset: 0,
		});

		const result = await getMismatchesFastPath(accessor, 'og:description');

		expect(result.total).toBe(3);
		expect(result.nextCursor).toBeNull();
		expect(result.prevCursor).toBeNull();
		expect(findMismatches).toHaveBeenCalledWith(accessor, 'og:description', {
			limit: undefined,
			offset: undefined,
			urlPattern: undefined,
			sortBy: undefined,
			sortOrder: undefined,
		});
		expect(listViewerMismatches).not.toHaveBeenCalled();
	});
});
