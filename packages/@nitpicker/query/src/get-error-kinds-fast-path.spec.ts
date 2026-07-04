import type { ErrorKindsResult, GetErrorKindsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./get-error-kinds.js', () => ({ getErrorKinds: vi.fn() }));
vi.mock('./get-viewer-error-kinds.js', () => ({ getViewerErrorKinds: vi.fn() }));
vi.mock('./viewer-read-model/is-viewer-read-model-current.js', () => ({
	isViewerReadModelCurrent: vi.fn(),
}));

const { getErrorKinds } = await import('./get-error-kinds.js');
const { getViewerErrorKinds } = await import('./get-viewer-error-kinds.js');
const { isViewerReadModelCurrent } =
	await import('./viewer-read-model/is-viewer-read-model-current.js');
const { getErrorKindsFastPath } = await import('./get-error-kinds-fast-path.js');

/**
 * Minimal `ErrorKindsResult` literal — the dispatcher treats the value
 * opaquely, so a sentinel field is enough to tell which backend answered.
 * @param channelSource - Identifying field to distinguish results across tests.
 * @returns An `ErrorKindsResult`-shaped object.
 */
function makeResult(
	channelSource: ErrorKindsResult['facets']['channelSource'],
): ErrorKindsResult {
	return { items: [], total: 0, facets: { totalRecords: 0, channelSource } };
}

const accessor = {} as ArchiveAccessor;

afterEach(() => {
	vi.clearAllMocks();
});

describe('getErrorKindsFastPath', () => {
	it('reads from the viewer_error_kind_* read model when it is current, defaulting options to {}', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(getViewerErrorKinds).mockResolvedValue(makeResult('crawl_errors'));

		const result = await getErrorKindsFastPath(accessor);

		expect(result.facets.channelSource).toBe('crawl_errors');
		expect(getViewerErrorKinds).toHaveBeenCalledWith(accessor, {});
		expect(getErrorKinds).not.toHaveBeenCalled();
	});

	it('falls back to the legacy classify-and-aggregate pass when the read model is stale or absent', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(getErrorKinds).mockResolvedValue(makeResult('error.log'));

		const result = await getErrorKindsFastPath(accessor);

		expect(result.facets.channelSource).toBe('error.log');
		expect(getErrorKinds).toHaveBeenCalledWith(accessor, {});
		expect(getViewerErrorKinds).not.toHaveBeenCalled();
	});

	it('passes explicit options through unchanged to whichever backend answers', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(getViewerErrorKinds).mockResolvedValue(makeResult('crawl_errors'));
		const options: GetErrorKindsOptions = { kind: 'dns', sortBy: 'host', limit: 10 };

		await getErrorKindsFastPath(accessor, options);

		expect(getViewerErrorKinds).toHaveBeenCalledWith(accessor, options);
	});
});
