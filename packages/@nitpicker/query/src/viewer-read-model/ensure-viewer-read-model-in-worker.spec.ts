import type { ArchiveAccessor } from '@nitpicker/crawler';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unlike ensure-viewer-read-model.spec.ts (which exercises a real fixture
// archive), this spec mocks its two collaborators: actually building via a
// real worker thread requires the compiled lib/ entry, which unit tests
// never have — the real-thread path is covered by the
// viewer-read-model-build e2e. What is left to verify here is only the
// gate-then-delegate branching.
// vi.hoisted (not bare consts): the static import of the module under test
// below evaluates before this file's own statements, which triggers the mock
// factories — a bare `const mockFn = vi.fn()` would still be in its temporal
// dead zone at that point.
const { mockGetViewerReadModelVersion, mockBuildViewerReadModelInWorker } = vi.hoisted(
	() => ({
		mockGetViewerReadModelVersion: vi.fn(),
		mockBuildViewerReadModelInWorker: vi.fn(),
	}),
);

vi.mock('./get-viewer-read-model-version.js', () => ({
	getViewerReadModelVersion: mockGetViewerReadModelVersion,
}));

vi.mock('./worker/build-viewer-read-model-in-worker.js', () => ({
	buildViewerReadModelInWorker: mockBuildViewerReadModelInWorker,
}));

import { ensureViewerReadModelInWorker } from './ensure-viewer-read-model-in-worker.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

const fakeAccessor = {} as ArchiveAccessor;

describe('ensureViewerReadModelInWorker', () => {
	beforeEach(() => {
		mockGetViewerReadModelVersion.mockReset();
		mockBuildViewerReadModelInWorker.mockReset().mockResolvedValue();
	});

	it('does nothing and reports false when the read model is already current', async () => {
		mockGetViewerReadModelVersion.mockResolvedValue(VIEWER_READ_MODEL_SCHEMA_VERSION);

		await expect(ensureViewerReadModelInWorker(fakeAccessor)).resolves.toBe(false);

		expect(mockBuildViewerReadModelInWorker).not.toHaveBeenCalled();
	});

	it('delegates to the worker build and reports true when no read model exists', async () => {
		mockGetViewerReadModelVersion.mockResolvedValue(null);

		await expect(ensureViewerReadModelInWorker(fakeAccessor)).resolves.toBe(true);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledWith(fakeAccessor, {});
	});

	it('delegates and forwards options when the persisted version is stale', async () => {
		mockGetViewerReadModelVersion.mockResolvedValue(0);
		const onPhase = vi.fn();

		await expect(ensureViewerReadModelInWorker(fakeAccessor, { onPhase })).resolves.toBe(
			true,
		);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledWith(fakeAccessor, {
			onPhase,
		});
	});

	it('propagates a worker build failure to the caller', async () => {
		mockGetViewerReadModelVersion.mockResolvedValue(null);
		mockBuildViewerReadModelInWorker.mockRejectedValue(new Error('worker died'));

		await expect(ensureViewerReadModelInWorker(fakeAccessor)).rejects.toThrow(
			'worker died',
		);
	});
});
