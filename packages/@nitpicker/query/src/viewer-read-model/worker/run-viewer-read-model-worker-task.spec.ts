import type { ArchiveAccessor } from '@nitpicker/crawler';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same tactic as @nitpicker/core's worker-pool.spec.ts: no real thread is
// ever spawned — node:worker_threads is replaced with an EventEmitter-based
// MockWorker so tests drive the protocol by emitting events. Actually
// spawning the compiled entry is covered by the viewer-read-model-build e2e
// (which runs the built CLI as a child process). The thin public faces
// (build-viewer-read-model-in-worker / run-viewer-read-model-backfills-in-
// worker) have their own delegation specs.
const { MockWorker, mockWorkers } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	const { EventEmitter } = require('node:events');

	const workers: MockWorker[] = [];

	/** Simulates a node:worker_threads Worker for unit-testing the wrapper. */
	class MockWorker extends EventEmitter {
		constructor(
			public readonly workerPath: string,
			public readonly options: { workerData?: unknown },
		) {
			super();
			workers.push(this);
		}
	}

	return { MockWorker, mockWorkers: workers };
});

vi.mock('node:worker_threads', () => ({
	Worker: MockWorker,
}));

import { runViewerReadModelWorkerTask } from './run-viewer-read-model-worker-task.js';

/**
 * Builds a minimal accessor stub exposing only the two members the wrapper
 * reads (`readOnly` and `tmpDir`).
 * @param readOnly - The stub's `readOnly` flag.
 */
function createAccessorStub(readOnly: boolean): ArchiveAccessor {
	return { readOnly, tmpDir: '/tmp/archive-dir' } as ArchiveAccessor;
}

describe('runViewerReadModelWorkerTask', () => {
	beforeEach(() => {
		mockWorkers.length = 0;
	});

	it('rejects a read-only accessor without spawning a worker', async () => {
		await expect(
			runViewerReadModelWorkerTask(createAccessorStub(true), 'build'),
		).rejects.toThrow(/read-only/i);
		expect(mockWorkers).toHaveLength(0);
	});

	it('spawns the worker entry with the accessor tmpDir as workerData', async () => {
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build');
		const worker = mockWorkers[0]!;

		expect(worker.workerPath).toMatch(/viewer-read-model-worker-entry\.js$/);
		expect(worker.options.workerData).toEqual({
			tmpDir: '/tmp/archive-dir',
			task: 'build',
		});

		worker.emit('message', { type: 'done' });
		await expect(promise).resolves.toBeUndefined();
	});

	it("passes the 'backfills' task through to workerData", async () => {
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'backfills');
		const worker = mockWorkers[0]!;

		expect(worker.options.workerData).toEqual({
			tmpDir: '/tmp/archive-dir',
			task: 'backfills',
		});

		worker.emit('message', { type: 'done' });
		await expect(promise).resolves.toBeUndefined();
	});

	it('relays phase messages to onPhase on the calling thread', async () => {
		const onPhase = vi.fn();
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build', {
			onPhase,
		});
		const worker = mockWorkers[0]!;

		worker.emit('message', { type: 'phase', phase: 'buildingAnchorFacts' });
		worker.emit('message', { type: 'phase', phase: 'creatingIndexes' });
		worker.emit('message', { type: 'done' });
		await promise;

		expect(onPhase.mock.calls).toEqual([['buildingAnchorFacts'], ['creatingIndexes']]);
	});

	it('relays progress messages to onProgress on the calling thread', async () => {
		const onProgress = vi.fn();
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build', {
			onProgress,
		});
		const worker = mockWorkers[0]!;

		worker.emit('message', {
			type: 'progress',
			progress: { insertedRows: 250, totalRows: 500 },
		});
		worker.emit('message', { type: 'done' });
		await promise;

		expect(onProgress).toHaveBeenCalledWith({ insertedRows: 250, totalRows: 500 });
	});

	it('rejects when the worker reports a build failure', async () => {
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build');
		const assertion = expect(promise).rejects.toThrow('db exploded');
		const worker = mockWorkers[0]!;

		worker.emit('message', { type: 'error', message: 'db exploded' });
		await assertion;
	});

	it('rejects when the worker itself errors (failed spawn / uncaught throw)', async () => {
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build');
		const assertion = expect(promise).rejects.toThrow('spawn failed');
		const worker = mockWorkers[0]!;

		worker.emit('error', new Error('spawn failed'));
		await assertion;
	});

	it('rejects when the worker exits before reporting completion', async () => {
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build');
		const assertion = expect(promise).rejects.toThrow(/exit code 1/);
		const worker = mockWorkers[0]!;

		worker.emit('exit', 1);
		await assertion;
	});

	it('keeps the done resolution when the normal post-done exit event follows', async () => {
		const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build');
		const worker = mockWorkers[0]!;

		worker.emit('message', { type: 'done' });
		worker.emit('exit', 0);

		await expect(promise).resolves.toBeUndefined();
	});

	it("surfaces a late worker 'error' after the promise already settled via console.warn instead of dropping it (issue #294 code review)", async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const promise = runViewerReadModelWorkerTask(createAccessorStub(false), 'build');
			const worker = mockWorkers[0]!;

			worker.emit('message', { type: 'done' });
			await expect(promise).resolves.toBeUndefined();

			worker.emit('error', new Error('late spawn error'));

			expect(warnSpy).toHaveBeenCalledOnce();
			expect(warnSpy.mock.calls[0]![0]).toContain('late spawn error');
		} finally {
			warnSpy.mockRestore();
		}
	});
});
