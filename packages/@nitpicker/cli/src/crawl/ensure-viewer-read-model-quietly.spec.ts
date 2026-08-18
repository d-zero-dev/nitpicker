import type { Archive } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockBuildViewerReadModelInWorker = vi.fn();
const mockLanesUpdate = vi.fn();

vi.mock('@nitpicker/query', () => ({
	buildViewerReadModelInWorker: mockBuildViewerReadModelInWorker,
}));

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: {
		update: typeof mockLanesUpdate;
		[Symbol.dispose]: ReturnType<typeof vi.fn>;
	}) {
		this.update = mockLanesUpdate;
		this[Symbol.dispose] = vi.fn();
	}),
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

	it('displays progress via a single Lanes line, same convention as the crawl/analyze commands', async () => {
		mockBuildViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onProgress({ insertedRows: 50, totalRows: 100 });
			return Promise.resolve();
		});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringContaining('50/100'),
		);
	});

	it('displays phase changes via the same Lanes line (issue #294)', async () => {
		mockBuildViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onPhase('buildingAnchorFacts');
			return Promise.resolve();
		});
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringContaining('Building anchor facts'),
		);
	});

	it('passes the verbose option through to Lanes so --verbose appends instead of overwriting', async () => {
		mockBuildViewerReadModelInWorker.mockResolvedValue();
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive, { verbose: true });

		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
	});

	it('logs a start line before the build and a completed line after it, with no timestamp by default', async () => {
		mockBuildViewerReadModelInWorker.mockResolvedValue();
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'Viewer read model build: starting',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'Viewer read model build: completed',
		);
	});

	it('prefixes every line with an ISO 8601 timestamp in --verbose mode (issue #294)', async () => {
		mockBuildViewerReadModelInWorker.mockResolvedValue();
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await ensureViewerReadModelQuietly(fakeArchive, { verbose: true });

		const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(new RegExp(`^${isoTimestamp.source} .*build: starting$`)),
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(new RegExp(`^${isoTimestamp.source} .*build: completed$`)),
		);
	});

	it('swallows a build failure and logs a warning instead of throwing', async () => {
		mockBuildViewerReadModelInWorker.mockRejectedValue(new Error('disk full'));
		const { ensureViewerReadModelQuietly } =
			await import('./ensure-viewer-read-model-quietly.js');

		await expect(ensureViewerReadModelQuietly(fakeArchive)).resolves.toBeUndefined();
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringContaining('disk full'),
		);
	});
});
