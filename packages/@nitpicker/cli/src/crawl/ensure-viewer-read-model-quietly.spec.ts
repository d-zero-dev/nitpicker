import type { Archive } from '@nitpicker/crawler';

import { describe, it, expect, vi, afterEach } from 'vitest';

const mockBuildViewerReadModel = vi.fn();

vi.mock('@nitpicker/query', () => ({
	buildViewerReadModel: mockBuildViewerReadModel,
}));

const fakeArchive = {} as Archive;

describe('ensureViewerReadModelQuietly', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('unconditionally rebuilds via buildViewerReadModel with an onProgress callback', async () => {
		// Not ensureViewerReadModel: that gate only checks schema_version, so
		// a re-crawl (--append / --retry-failed / --inventory) against an
		// archive whose read model was already built once at the current
		// schema would silently skip the rebuild and leave newly-written
		// data unreflected. Correctness first — this is unconditional even
		// though it means the same full-table rebuild cost as a fresh crawl.
		mockBuildViewerReadModel.mockResolvedValue();
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive);

		expect(mockBuildViewerReadModel).toHaveBeenCalledWith(
			fakeArchive,
			expect.objectContaining({ onProgress: expect.any(Function) }),
		);
	});

	it('logs each progress callback to stderr', async () => {
		mockBuildViewerReadModel.mockImplementation((_archive, options) => {
			options.onProgress({ insertedRows: 50, totalRows: 100 });
			return Promise.resolve();
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive);

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('50/100'));
	});

	it('swallows a build failure and logs a warning instead of throwing', async () => {
		mockBuildViewerReadModel.mockRejectedValue(new Error('disk full'));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await expect(ensureViewerReadModelQuietly(fakeArchive)).resolves.toBeUndefined();
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'));
	});
});
