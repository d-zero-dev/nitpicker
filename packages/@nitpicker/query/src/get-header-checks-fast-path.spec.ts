import type { CursorPaginatedHeaderCheckList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./check-headers.js', () => ({ checkHeaders: vi.fn() }));
vi.mock('./list-viewer-header-checks.js', () => ({ listViewerHeaderChecks: vi.fn() }));
vi.mock('./viewer-read-model/is-viewer-read-model-current.js', () => ({
	isViewerReadModelCurrent: vi.fn(),
}));

const { checkHeaders } = await import('./check-headers.js');
const { listViewerHeaderChecks } = await import('./list-viewer-header-checks.js');
const { isViewerReadModelCurrent } =
	await import('./viewer-read-model/is-viewer-read-model-current.js');
const { getHeaderChecksFastPath } = await import('./get-header-checks-fast-path.js');

/**
 * Minimal `CursorPaginatedHeaderCheckList`-shaped literal — the dispatcher
 * treats the value opaquely, so an empty `items` array plus a sentinel
 * `total` is enough to tell which backend answered.
 * @param total - Identifying field to distinguish results across tests.
 * @returns A `CursorPaginatedHeaderCheckList`-shaped object.
 */
function makeResult(total: number): CursorPaginatedHeaderCheckList {
	return { items: [], total, offset: 0, limit: 100, nextCursor: null, prevCursor: null };
}

const accessor = {} as ArchiveAccessor;

afterEach(() => {
	vi.clearAllMocks();
});

describe('getHeaderChecksFastPath', () => {
	it('reads from the viewer_header_checks read model when it is current and sortBy is unset', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerHeaderChecks).mockResolvedValue(makeResult(1));

		const result = await getHeaderChecksFastPath(accessor, { missingOnly: true });

		expect(result.total).toBe(1);
		expect(listViewerHeaderChecks).toHaveBeenCalledWith(accessor, {
			missingOnly: true,
			hasCSP: undefined,
			hasXFrameOptions: undefined,
			hasXContentTypeOptions: undefined,
			hasHSTS: undefined,
			sortOrder: undefined,
			limit: undefined,
			offset: undefined,
			cursor: undefined,
			direction: undefined,
		});
		expect(checkHeaders).not.toHaveBeenCalled();
	});

	it('forces the legacy path when sortBy is explicitly "url" — checkHeaders treats this as a request for natural sort, which the fast path cannot provide', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(checkHeaders).mockResolvedValue({
			items: [],
			total: 1,
			offset: 0,
			limit: 100,
		});

		await getHeaderChecksFastPath(accessor, { sortBy: 'url' });

		expect(checkHeaders).toHaveBeenCalledWith(accessor, { sortBy: 'url' });
		expect(listViewerHeaderChecks).not.toHaveBeenCalled();
	});

	it('forwards cursor/direction to the fast path', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(listViewerHeaderChecks).mockResolvedValue(makeResult(1));

		await getHeaderChecksFastPath(accessor, {
			cursor: 'opaque-cursor',
			direction: 'prev',
		});

		expect(listViewerHeaderChecks).toHaveBeenCalledWith(
			accessor,
			expect.objectContaining({ cursor: 'opaque-cursor', direction: 'prev' }),
		);
	});

	it('falls back to the legacy path when the read model is stale or absent', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(checkHeaders).mockResolvedValue({
			items: [],
			total: 2,
			offset: 0,
			limit: 100,
		});

		const result = await getHeaderChecksFastPath(accessor);

		expect(result.total).toBe(2);
		expect(result.nextCursor).toBeNull();
		expect(result.prevCursor).toBeNull();
		expect(checkHeaders).toHaveBeenCalledWith(accessor, {});
		expect(listViewerHeaderChecks).not.toHaveBeenCalled();
	});

	it.each(['hasCSP', 'hasXFrameOptions', 'hasXContentTypeOptions', 'hasHSTS'] as const)(
		'forces the legacy path when sortBy is %s, even if the read model is current',
		async (sortBy) => {
			vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
			vi.mocked(checkHeaders).mockResolvedValue({
				items: [],
				total: 3,
				offset: 0,
				limit: 100,
			});

			await getHeaderChecksFastPath(accessor, { sortBy });

			expect(checkHeaders).toHaveBeenCalledWith(accessor, { sortBy });
			expect(listViewerHeaderChecks).not.toHaveBeenCalled();
		},
	);
});
