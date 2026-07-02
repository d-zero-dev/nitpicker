import type { Archive } from '@nitpicker/crawler';

import { describe, it, expect, vi, afterEach } from 'vitest';

const mockEnsureViewerReadModel = vi.fn();

vi.mock('@nitpicker/query', () => ({
	ensureViewerReadModel: mockEnsureViewerReadModel,
}));

const fakeArchive = {} as Archive;

describe('ensureViewerReadModelQuietly', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('delegates to ensureViewerReadModel with an onProgress callback', async () => {
		mockEnsureViewerReadModel.mockResolvedValue();
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive);

		expect(mockEnsureViewerReadModel).toHaveBeenCalledWith(
			fakeArchive,
			expect.objectContaining({ onProgress: expect.any(Function) }),
		);
	});

	it('logs each progress callback to stderr', async () => {
		mockEnsureViewerReadModel.mockImplementation((_archive, options) => {
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
		mockEnsureViewerReadModel.mockRejectedValue(new Error('disk full'));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await expect(ensureViewerReadModelQuietly(fakeArchive)).resolves.toBeUndefined();
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'));
	});
});
