import type { CursorPaginatedDuplicateGroupList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./count-duplicate-groups.js', () => ({ countDuplicateGroups: vi.fn() }));
vi.mock('./find-duplicates.js', () => ({ findDuplicates: vi.fn() }));
vi.mock('./list-viewer-duplicate-groups.js', () => ({
	listViewerDuplicateGroups: vi.fn(),
}));
vi.mock('./viewer-read-model/is-viewer-read-model-current.js', () => ({
	isViewerReadModelCurrent: vi.fn(),
}));

const { countDuplicateGroups } = await import('./count-duplicate-groups.js');
const { findDuplicates } = await import('./find-duplicates.js');
const { listViewerDuplicateGroups } = await import('./list-viewer-duplicate-groups.js');
const { isViewerReadModelCurrent } =
	await import('./viewer-read-model/is-viewer-read-model-current.js');
const { getDuplicatesFastPath } = await import('./get-duplicates-fast-path.js');

/**
 * Minimal `CursorPaginatedDuplicateGroupList`-shaped literal — the
 * dispatcher treats the value opaquely, so an empty `items` array plus a
 * sentinel `total` is enough to tell which backend answered.
 * @param total - Identifying field to distinguish results across tests.
 * @returns A `CursorPaginatedDuplicateGroupList`-shaped object.
 */
function makeResult(total: number): CursorPaginatedDuplicateGroupList {
	return { items: [], total, offset: 0, limit: 100, nextCursor: null, prevCursor: null };
}

const accessor = {} as ArchiveAccessor;

afterEach(() => {
	vi.clearAllMocks();
});

describe('getDuplicatesFastPath', () => {
	it('reads from the viewer_duplicate_groups read model when it is current, defaulting field to title', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerDuplicateGroups).mockResolvedValue(makeResult(1));

		const result = await getDuplicatesFastPath(accessor);

		expect(result.total).toBe(1);
		expect(listViewerDuplicateGroups).toHaveBeenCalledWith(accessor, {
			field: 'title',
			pagesLimit: 20,
			limit: 50,
			cursor: undefined,
			direction: undefined,
			offset: undefined,
		});
		expect(findDuplicates).not.toHaveBeenCalled();
		expect(countDuplicateGroups).not.toHaveBeenCalled();
	});

	it('applies its own default limit (50) on the fast path instead of leaking listViewerDuplicateGroups’s own default', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerDuplicateGroups).mockResolvedValue(makeResult(1));

		await getDuplicatesFastPath(accessor);

		expect(listViewerDuplicateGroups).toHaveBeenCalledWith(
			accessor,
			expect.objectContaining({ limit: 50 }),
		);
	});

	it('forwards an explicit field/pagesLimit/cursor/direction to the fast path', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerDuplicateGroups).mockResolvedValue(makeResult(1));

		await getDuplicatesFastPath(accessor, {
			field: 'description',
			pagesLimit: 5,
			cursor: 'opaque-cursor',
			direction: 'prev',
		});

		expect(listViewerDuplicateGroups).toHaveBeenCalledWith(
			accessor,
			expect.objectContaining({
				field: 'description',
				pagesLimit: 5,
				cursor: 'opaque-cursor',
				direction: 'prev',
			}),
		);
	});

	it('falls back to the live path when the read model is stale or absent, converting the shape', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(findDuplicates).mockResolvedValue([
			{ field: 'title', value: 'Dup A', count: 3, urls: ['u1', 'u2', 'u3'] },
			{ field: 'title', value: 'Dup B', count: 2, urls: ['u4', 'u5'] },
		]);
		vi.mocked(countDuplicateGroups).mockResolvedValue(200);

		const result = await getDuplicatesFastPath(accessor);

		expect(findDuplicates).toHaveBeenCalledWith(accessor, 'title', 50, 0);
		expect(countDuplicateGroups).toHaveBeenCalledWith(accessor, 'title');
		expect(listViewerDuplicateGroups).not.toHaveBeenCalled();
		expect(result).toEqual({
			items: [
				{
					groupId: -1,
					field: 'title',
					value: 'Dup A',
					count: 3,
					pages: ['u1', 'u2', 'u3'],
				},
				{ groupId: -2, field: 'title', value: 'Dup B', count: 2, pages: ['u4', 'u5'] },
			],
			// The real archive-wide count, not `items.length` — this archive has
			// 200 duplicate title-groups even though only 2 (this page's `limit`)
			// were fetched.
			total: 200,
			limit: 50,
			offset: 0,
			nextCursor: null,
			prevCursor: null,
		});
	});

	it('never truncates the live pages sample — findDuplicates already returns every member URL', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(findDuplicates).mockResolvedValue([
			{ field: 'title', value: 'Dup A', count: 3, urls: ['u1', 'u2', 'u3'] },
		]);
		vi.mocked(countDuplicateGroups).mockResolvedValue(1);

		const result = await getDuplicatesFastPath(accessor, { pagesLimit: 2 });

		expect(result.items[0]!.pages).toEqual(['u1', 'u2', 'u3']);
	});

	it('mints a non-positive groupId sentinel on the live branch, distinct from real viewer_duplicate_groups ids', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(findDuplicates).mockResolvedValue([
			{ field: 'title', value: 'Dup A', count: 2, urls: ['u1', 'u2'] },
			{ field: 'title', value: 'Dup B', count: 2, urls: ['u3', 'u4'] },
		]);
		vi.mocked(countDuplicateGroups).mockResolvedValue(2);

		const result = await getDuplicatesFastPath(accessor);

		expect(result.items.map((item) => item.groupId)).toEqual([-1, -2]);
		expect(result.items.every((item) => item.groupId <= 0)).toBe(true);
	});

	it('forwards an explicit limit and offset to the live findDuplicates/countDuplicateGroups calls', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(findDuplicates).mockResolvedValue([]);
		vi.mocked(countDuplicateGroups).mockResolvedValue(0);

		const result = await getDuplicatesFastPath(accessor, { limit: 5, offset: 10 });

		expect(findDuplicates).toHaveBeenCalledWith(accessor, 'title', 5, 10);
		expect(result.limit).toBe(5);
		expect(result.offset).toBe(10);
	});
});
