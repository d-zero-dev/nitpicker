import type { CursorPaginatedImageList, ListImagesOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./list-images.js', () => ({ listImages: vi.fn() }));
vi.mock('./list-viewer-images.js', () => ({ listViewerImages: vi.fn() }));
vi.mock('./viewer-read-model/is-viewer-read-model-current.js', () => ({
	isViewerReadModelCurrent: vi.fn(),
}));

const { listImages } = await import('./list-images.js');
const { listViewerImages } = await import('./list-viewer-images.js');
const { isViewerReadModelCurrent } =
	await import('./viewer-read-model/is-viewer-read-model-current.js');
const { getImagesFastPath } = await import('./get-images-fast-path.js');

/**
 * Minimal `CursorPaginatedImageList`-shaped literal — the dispatcher treats
 * the value opaquely, so an empty `items` array plus a sentinel `total` is
 * enough to tell which backend answered.
 * @param total - Identifying field to distinguish results across tests.
 * @returns A `CursorPaginatedImageList`-shaped object.
 */
function makeResult(total: number): CursorPaginatedImageList {
	return { items: [], total, offset: 0, limit: 100, nextCursor: null, prevCursor: null };
}

const accessor = {} as ArchiveAccessor;

afterEach(() => {
	vi.clearAllMocks();
});

describe('getImagesFastPath', () => {
	it('reads from the viewer_images read model when it is current and no wide-table-only filter is used', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerImages).mockResolvedValue(makeResult(1));

		const result = await getImagesFastPath(accessor, { missingAlt: true });

		expect(result.total).toBe(1);
		expect(listViewerImages).toHaveBeenCalledWith(accessor, {
			missingAlt: true,
			missingDimensions: undefined,
			oversizedThreshold: undefined,
			sortBy: undefined,
			sortOrder: undefined,
			limit: undefined,
			offset: undefined,
			cursor: undefined,
			direction: undefined,
		});
		expect(listImages).not.toHaveBeenCalled();
	});

	it('forwards cursor/direction to the fast path — the only production path that ever sets them', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerImages).mockResolvedValue(makeResult(1));

		await getImagesFastPath(accessor, { cursor: 'opaque-cursor', direction: 'prev' });

		expect(listViewerImages).toHaveBeenCalledWith(
			accessor,
			expect.objectContaining({ cursor: 'opaque-cursor', direction: 'prev' }),
		);
	});

	it('falls back to the legacy path when the read model is stale or absent', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(listImages).mockResolvedValue({
			items: [],
			total: 2,
			offset: 0,
			limit: 100,
		});

		const result = await getImagesFastPath(accessor);

		expect(result.total).toBe(2);
		expect(result.nextCursor).toBeNull();
		expect(result.prevCursor).toBeNull();
		expect(listImages).toHaveBeenCalledWith(accessor, {});
		expect(listViewerImages).not.toHaveBeenCalled();
	});

	it('forces the legacy path when urlPattern is supplied, even if the read model is current', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listImages).mockResolvedValue({
			items: [],
			total: 3,
			offset: 0,
			limit: 100,
		});
		const options: ListImagesOptions = { urlPattern: '%.png' };

		await getImagesFastPath(accessor, options);

		expect(listImages).toHaveBeenCalledWith(accessor, options);
		expect(listViewerImages).not.toHaveBeenCalled();
	});

	it.each(['src', 'alt'] as const)(
		'forces the legacy path when sortBy is %s, even if the read model is current',
		async (sortBy) => {
			vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
			vi.mocked(listImages).mockResolvedValue({
				items: [],
				total: 4,
				offset: 0,
				limit: 100,
			});

			await getImagesFastPath(accessor, { sortBy });

			expect(listImages).toHaveBeenCalledWith(accessor, { sortBy });
			expect(listViewerImages).not.toHaveBeenCalled();
		},
	);

	it.each([
		'pageUrl',
		'width',
		'height',
		'naturalWidth',
		'naturalHeight',
		'isLazy',
	] as const)(
		'uses the fast path for sortBy %s when the read model is current',
		async (sortBy) => {
			vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
			vi.mocked(listViewerImages).mockResolvedValue(makeResult(5));

			await getImagesFastPath(accessor, { sortBy });

			expect(listViewerImages).toHaveBeenCalled();
			expect(listImages).not.toHaveBeenCalled();
		},
	);
});
