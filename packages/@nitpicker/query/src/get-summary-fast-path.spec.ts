import type { SummaryResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./get-summary.js', () => ({ getSummary: vi.fn() }));
vi.mock('./get-viewer-summary.js', () => ({ getViewerSummary: vi.fn() }));
vi.mock('./viewer-read-model/is-viewer-read-model-current.js', () => ({
	isViewerReadModelCurrent: vi.fn(),
}));

const { getSummary } = await import('./get-summary.js');
const { getViewerSummary } = await import('./get-viewer-summary.js');
const { isViewerReadModelCurrent } =
	await import('./viewer-read-model/is-viewer-read-model-current.js');
const { getSummaryFastPath } = await import('./get-summary-fast-path.js');

/**
 * Minimal `SummaryResult` literal — the dispatcher treats the value
 * opaquely, so a sentinel field is enough to tell which backend answered.
 * @param baseUrl - Identifying field to distinguish results across tests.
 * @returns A `SummaryResult`-shaped object.
 */
function makeSummary(baseUrl: string): SummaryResult {
	return {
		baseUrl,
		roots: [],
		totalPages: 0,
		internalPages: 0,
		externalPages: 0,
		internalContents: 0,
		externalContents: 0,
		statusDistribution: [],
		metadataFulfillment: {
			title: 0,
			description: 0,
			keywords: 0,
			ogTitle: 0,
			ogDescription: 0,
			ogImage: 0,
		},
		contentTypeDistribution: [],
	};
}

const accessor = {} as ArchiveAccessor;

afterEach(() => {
	vi.clearAllMocks();
});

describe('getSummaryFastPath', () => {
	it('reads from the viewer_summary read model when it is current', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(true);
		vi.mocked(getViewerSummary).mockResolvedValue(makeSummary('fast-path'));

		const result = await getSummaryFastPath(accessor);

		expect(result.baseUrl).toBe('fast-path');
		expect(getViewerSummary).toHaveBeenCalledWith(accessor);
		expect(getSummary).not.toHaveBeenCalled();
	});

	it('falls back to the legacy full aggregation when the read model is stale or absent', async () => {
		vi.mocked(isViewerReadModelCurrent).mockResolvedValue(false);
		vi.mocked(getSummary).mockResolvedValue(makeSummary('legacy'));

		const result = await getSummaryFastPath(accessor);

		expect(result.baseUrl).toBe('legacy');
		expect(getSummary).toHaveBeenCalledWith(accessor);
		expect(getViewerSummary).not.toHaveBeenCalled();
	});
});
