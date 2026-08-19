import type { Archive } from '@nitpicker/crawler';

import { describe, it, expect, vi, afterEach } from 'vitest';

const mockScanJsResourcesForTechnologySignals = vi.fn();

vi.mock('@nitpicker/crawler', () => ({
	scanJsResourcesForTechnologySignals: mockScanJsResourcesForTechnologySignals,
}));

const fakeArchive = {} as Archive;

describe('scanJsResourcesQuietly', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('delegates to scanJsResourcesForTechnologySignals, wiring onProgress (issue #294)', async () => {
		mockScanJsResourcesForTechnologySignals.mockResolvedValue({
			candidateCount: 0,
			scannedCount: 0,
			matchedCount: 0,
			pagesUpdatedCount: 0,
		});
		const { scanJsResourcesQuietly } = await import('./scan-js-resources-quietly.js');

		await scanJsResourcesQuietly(fakeArchive);

		expect(mockScanJsResourcesForTechnologySignals).toHaveBeenCalledWith(fakeArchive, {
			onProgress: expect.any(Function),
		});
	});

	it('reports onProgress updates through the injected callback (issue #294)', async () => {
		mockScanJsResourcesForTechnologySignals.mockImplementation(
			(
				_archive: Archive,
				options: { onProgress?: (done: number, total: number) => void },
			) => {
				options.onProgress?.(3, 10);
				return Promise.resolve({
					candidateCount: 10,
					scannedCount: 10,
					matchedCount: 1,
					pagesUpdatedCount: 1,
				});
			},
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { scanJsResourcesQuietly } = await import('./scan-js-resources-quietly.js');
		const onProgress = vi.fn();

		await scanJsResourcesQuietly(fakeArchive, onProgress);

		expect(onProgress).toHaveBeenCalledWith('3/10 resources (30%)');
	});

	it('does not throw when onProgress is omitted', async () => {
		mockScanJsResourcesForTechnologySignals.mockImplementation(
			(
				_archive: Archive,
				options: { onProgress?: (done: number, total: number) => void },
			) => {
				options.onProgress?.(3, 10);
				return Promise.resolve({
					candidateCount: 10,
					scannedCount: 10,
					matchedCount: 1,
					pagesUpdatedCount: 1,
				});
			},
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { scanJsResourcesQuietly } = await import('./scan-js-resources-quietly.js');

		await expect(scanJsResourcesQuietly(fakeArchive)).resolves.toBeUndefined();
	});

	it('logs a one-line summary to stderr when at least one resource was scanned', async () => {
		mockScanJsResourcesForTechnologySignals.mockResolvedValue({
			candidateCount: 3,
			scannedCount: 3,
			matchedCount: 1,
			pagesUpdatedCount: 2,
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { scanJsResourcesQuietly } = await import('./scan-js-resources-quietly.js');

		await scanJsResourcesQuietly(fakeArchive);

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('1 match(es) across 3 resource(s), 2 page(s) updated'),
		);
	});

	it('stays silent when there were no candidate resources', async () => {
		mockScanJsResourcesForTechnologySignals.mockResolvedValue({
			candidateCount: 0,
			scannedCount: 0,
			matchedCount: 0,
			pagesUpdatedCount: 0,
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { scanJsResourcesQuietly } = await import('./scan-js-resources-quietly.js');

		await scanJsResourcesQuietly(fakeArchive);

		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('swallows a scan failure and logs a warning instead of throwing', async () => {
		mockScanJsResourcesForTechnologySignals.mockRejectedValue(new Error('DNS failure'));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { scanJsResourcesQuietly } = await import('./scan-js-resources-quietly.js');

		await expect(scanJsResourcesQuietly(fakeArchive)).resolves.toBeUndefined();
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DNS failure'));
	});

	it('reports a failure to onProgress too, so the TaskList row does not settle silently as done (issue #294 code review)', async () => {
		mockScanJsResourcesForTechnologySignals.mockRejectedValue(new Error('DNS failure'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { scanJsResourcesQuietly } = await import('./scan-js-resources-quietly.js');
		const onProgress = vi.fn();

		await scanJsResourcesQuietly(fakeArchive, onProgress);

		expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('DNS failure'));
	});
});
