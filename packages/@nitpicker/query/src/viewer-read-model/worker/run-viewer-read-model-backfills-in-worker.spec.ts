import type { ArchiveAccessor } from '@nitpicker/crawler';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Thin delegation spec: the worker lifecycle (spawn, relay, reject routes)
// is covered by run-viewer-read-model-worker-task.spec.ts — what is left to
// verify here is only that this face binds the 'backfills' task.
const { mockRunViewerReadModelWorkerTask } = vi.hoisted(() => ({
	mockRunViewerReadModelWorkerTask: vi.fn(),
}));

vi.mock('./run-viewer-read-model-worker-task.js', () => ({
	runViewerReadModelWorkerTask: mockRunViewerReadModelWorkerTask,
}));

import { runViewerReadModelBackfillsInWorker } from './run-viewer-read-model-backfills-in-worker.js';

const fakeAccessor = {} as ArchiveAccessor;

describe('runViewerReadModelBackfillsInWorker', () => {
	beforeEach(() => {
		mockRunViewerReadModelWorkerTask.mockReset().mockResolvedValue();
	});

	it("delegates to the shared worker runner with the 'backfills' task", async () => {
		const onProgress = vi.fn();

		await runViewerReadModelBackfillsInWorker(fakeAccessor, { onProgress });

		expect(mockRunViewerReadModelWorkerTask).toHaveBeenCalledWith(
			fakeAccessor,
			'backfills',
			{ onProgress },
		);
	});

	it('defaults options to an empty object', async () => {
		await runViewerReadModelBackfillsInWorker(fakeAccessor);

		expect(mockRunViewerReadModelWorkerTask).toHaveBeenCalledWith(
			fakeAccessor,
			'backfills',
			{},
		);
	});

	it('propagates a worker task failure to the caller', async () => {
		mockRunViewerReadModelWorkerTask.mockRejectedValue(new Error('worker died'));

		await expect(runViewerReadModelBackfillsInWorker(fakeAccessor)).rejects.toThrow(
			'worker died',
		);
	});
});
