import type { ArchiveAccessor } from '@nitpicker/crawler';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Thin delegation spec: the worker lifecycle (spawn, relay, reject routes)
// is covered by run-viewer-read-model-worker-task.spec.ts — what is left to
// verify here is only that this face binds the 'build' task.
const { mockRunViewerReadModelWorkerTask } = vi.hoisted(() => ({
	mockRunViewerReadModelWorkerTask: vi.fn(),
}));

vi.mock('./run-viewer-read-model-worker-task.js', () => ({
	runViewerReadModelWorkerTask: mockRunViewerReadModelWorkerTask,
}));

import { buildViewerReadModelInWorker } from './build-viewer-read-model-in-worker.js';

const fakeAccessor = {} as ArchiveAccessor;

describe('buildViewerReadModelInWorker', () => {
	beforeEach(() => {
		mockRunViewerReadModelWorkerTask.mockReset().mockResolvedValue();
	});

	it("delegates to the shared worker runner with the 'build' task", async () => {
		const onPhase = vi.fn();

		await buildViewerReadModelInWorker(fakeAccessor, { onPhase });

		expect(mockRunViewerReadModelWorkerTask).toHaveBeenCalledWith(fakeAccessor, 'build', {
			onPhase,
		});
	});

	it('defaults options to an empty object', async () => {
		await buildViewerReadModelInWorker(fakeAccessor);

		expect(mockRunViewerReadModelWorkerTask).toHaveBeenCalledWith(
			fakeAccessor,
			'build',
			{},
		);
	});

	it('propagates a worker task failure to the caller', async () => {
		mockRunViewerReadModelWorkerTask.mockRejectedValue(new Error('worker died'));

		await expect(buildViewerReadModelInWorker(fakeAccessor)).rejects.toThrow(
			'worker died',
		);
	});
});
