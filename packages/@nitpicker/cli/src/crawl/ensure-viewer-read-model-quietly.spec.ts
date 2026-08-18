import type { Archive } from '@nitpicker/crawler';

import { describe, it, expect, vi, afterEach } from 'vitest';

const mockBuildViewerReadModelInWorker = vi.fn();

vi.mock('@nitpicker/query', () => ({
	buildViewerReadModelInWorker: mockBuildViewerReadModelInWorker,
}));

const fakeArchive = {} as Archive;

describe('ensureViewerReadModelQuietly', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('unconditionally rebuilds via buildViewerReadModelInWorker with an onProgress callback', async () => {
		// Not the schema-version-gated variant: that gate only checks schema_version, so
		// a re-crawl (--append / --retry-failed / --inventory) against an
		// archive whose read model was already built once at the current
		// schema would silently skip the rebuild and leave newly-written
		// data unreflected. Correctness first — this is unconditional even
		// though it means the same full-table rebuild cost as a fresh crawl.
		mockBuildViewerReadModelInWorker.mockResolvedValue();
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledWith(
			fakeArchive,
			expect.objectContaining({
				onProgress: expect.any(Function),
				onPhase: expect.any(Function),
			}),
		);
	});

	it('reports progress updates through the injected onProgress callback', async () => {
		mockBuildViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onProgress({ insertedRows: 50, totalRows: 100 });
			return Promise.resolve();
		});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');
		const onProgress = vi.fn();

		await ensureViewerReadModelQuietly(fakeArchive, onProgress);

		expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('50/100'));
	});

	it('reports phase changes through the injected onProgress callback (issue #294)', async () => {
		mockBuildViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onPhase('buildingAnchorFacts');
			return Promise.resolve();
		});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');
		const onProgress = vi.fn();

		await ensureViewerReadModelQuietly(fakeArchive, onProgress);

		expect(onProgress).toHaveBeenCalledWith(
			expect.stringContaining('Building anchor facts'),
		);
	});

	it('does not throw when onProgress is omitted', async () => {
		mockBuildViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onPhase('buildingAnchorFacts');
			options.onProgress({ insertedRows: 1, totalRows: 2 });
			return Promise.resolve();
		});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await expect(ensureViewerReadModelQuietly(fakeArchive)).resolves.toBeUndefined();
	});

	it('swallows a build failure and reports a failure summary instead of throwing', async () => {
		mockBuildViewerReadModelInWorker.mockRejectedValue(new Error('disk full'));
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');
		const onProgress = vi.fn();

		await expect(
			ensureViewerReadModelQuietly(fakeArchive, onProgress),
		).resolves.toBeUndefined();
		expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('disk full'));
	});
});
