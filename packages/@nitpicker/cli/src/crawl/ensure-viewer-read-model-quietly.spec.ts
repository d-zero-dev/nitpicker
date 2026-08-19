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

	it('unconditionally rebuilds via buildViewerReadModelInWorker', async () => {
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

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledWith(fakeArchive, {});
	});

	it('swallows a build failure instead of throwing', async () => {
		mockBuildViewerReadModelInWorker.mockRejectedValue(new Error('disk full'));
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await expect(ensureViewerReadModelQuietly(fakeArchive)).resolves.toBeUndefined();
	});
});
