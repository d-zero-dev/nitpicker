import type { UrlEventBus } from '../url-event-bus.js';

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/** Module-level state shared across MockWorker instances. */
const { MockWorker, mockWorkers } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	const { EventEmitter } = require('node:events');

	const workers: MockWorker[] = [];

	/** Simulates a node:worker_threads Worker for unit-testing the pool. */
	class MockWorker extends EventEmitter {
		/** Spy receiving every postMessage payload. */
		postMessage = vi.fn();
		/** Spy for terminate(); resolved synchronously by default. */
		terminate = vi.fn().mockResolvedValue();
		/** Spy for unref(). */
		unref = vi.fn();

		constructor(public readonly workerPath: string) {
			super();
			workers.push(this);
		}

		/**
		 * Simulates a fatal error event from the worker.
		 * @param error
		 */
		crash(error: Error) {
			this.emit('error', error);
		}
		/**
		 * Simulates the worker posting a result back to the pool.
		 * @param taskId
		 * @param result
		 * @param error
		 */
		respondWithResult(taskId: number, result: unknown, error?: string) {
			const payload: Record<string, unknown> = { type: 'result', taskId, result };
			if (error !== undefined) {
				payload.error = error;
			}
			this.emit('message', payload);
		}

		/**
		 * Simulates the worker forwarding a discovered URL.
		 * @param taskId
		 * @param url
		 */
		respondWithUrl(taskId: number, url: string) {
			this.emit('message', { type: 'url', taskId, url });
		}
	}

	return { MockWorker, mockWorkers: workers };
});

vi.mock('node:worker_threads', () => ({
	Worker: MockWorker,
}));

import { WorkerPool } from './worker-pool.js';

/** Creates a fresh emitter spy for tests that care about URL forwarding. */
function makeEmitter(): UrlEventBus {
	return {
		emit: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
	} as unknown as UrlEventBus;
}

describe('WorkerPool', () => {
	beforeEach(() => {
		mockWorkers.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('spawns the configured number of workers eagerly', () => {
		new WorkerPool({ size: 3, workerPath: '/worker.js' });
		expect(mockWorkers).toHaveLength(3);
		for (const worker of mockWorkers) {
			expect(worker.workerPath).toBe('/worker.js');
			expect(worker.unref).toHaveBeenCalled();
		}
	});

	it('clamps size below 1 to 1', () => {
		new WorkerPool({ size: 0, workerPath: '/worker.js' });
		expect(mockWorkers).toHaveLength(1);
	});

	it('dispatches a submitted task to an idle worker and resolves with the result', async () => {
		const pool = new WorkerPool({ size: 2, workerPath: '/worker.js' });

		const promise = pool.run({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter: makeEmitter(),
			initialData: { html: 'x' } as never,
		});

		const worker = mockWorkers[0];
		expect(worker.postMessage).toHaveBeenCalledTimes(1);
		const sent = worker.postMessage.mock.calls[0][0];
		expect(sent).toMatchObject({
			type: 'task',
			taskId: 0,
			data: { filePath: '/mod.js', num: 0, total: 1, html: 'x' },
		});

		worker.respondWithResult(0, { score: 99 });
		await expect(promise).resolves.toEqual({ score: 99 });
	});

	it('rejects with an Error when the worker reports an error result', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });

		const promise = pool.run({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter: makeEmitter(),
			initialData: {} as never,
		});

		mockWorkers[0].respondWithResult(0, null, 'plugin crashed');
		await expect(promise).rejects.toThrow('plugin crashed');
	});

	it('forwards url messages to the originating task emitter', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });
		const emitter = makeEmitter();

		const promise = pool.run({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter,
			initialData: {} as never,
		});

		mockWorkers[0].respondWithUrl(0, 'https://discovered.example.com/');
		mockWorkers[0].respondWithResult(0, null);

		await promise;
		expect(emitter.emit).toHaveBeenCalledWith('url', 'https://discovered.example.com/');
	});

	it('queues tasks beyond pool size and dispatches them as workers free up', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });

		const first = pool.run({
			filePath: '/mod.js',
			num: 0,
			total: 2,
			emitter: makeEmitter(),
			initialData: { tag: 'first' } as never,
		});
		const second = pool.run({
			filePath: '/mod.js',
			num: 1,
			total: 2,
			emitter: makeEmitter(),
			initialData: { tag: 'second' } as never,
		});

		const worker = mockWorkers[0];
		expect(worker.postMessage).toHaveBeenCalledTimes(1);
		expect(worker.postMessage.mock.calls[0][0].data.tag).toBe('first');

		worker.respondWithResult(0, 'a');
		await first;

		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.postMessage.mock.calls[1][0].data.tag).toBe('second');

		worker.respondWithResult(1, 'b');
		await expect(second).resolves.toBe('b');
	});

	it('rejects the running task and replaces the worker on a crash', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });

		const promise = pool.run({
			filePath: '/mod.js',
			num: 0,
			total: 1,
			emitter: makeEmitter(),
			initialData: {} as never,
		});

		const original = mockWorkers[0];
		original.crash(new Error('boom'));

		await expect(promise).rejects.toThrow('boom');
		// One replacement worker is spawned to keep the pool at the configured size
		expect(mockWorkers).toHaveLength(2);
	});

	it('rejects new submissions after terminate()', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });
		setImmediate(() => mockWorkers[0].emit('exit', 0));
		await pool.terminate();

		await expect(
			pool.run({
				filePath: '/mod.js',
				num: 0,
				total: 1,
				emitter: makeEmitter(),
				initialData: {} as never,
			}),
		).rejects.toThrow('shutting down');
	});

	it('sends a shutdown message to every worker on terminate()', async () => {
		const pool = new WorkerPool({ size: 2, workerPath: '/worker.js' });
		setImmediate(() => {
			for (const worker of mockWorkers) {
				worker.emit('exit', 0);
			}
		});

		await pool.terminate();

		for (const worker of mockWorkers) {
			expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
		}
	});

	it('rejects queued tasks when terminate() is called before they dispatch', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });

		// First task occupies the only worker; second task lives in the queue.
		const first = pool.run({
			filePath: '/mod.js',
			num: 0,
			total: 2,
			emitter: makeEmitter(),
			initialData: {} as never,
		});
		const queued = pool.run({
			filePath: '/mod.js',
			num: 1,
			total: 2,
			emitter: makeEmitter(),
			initialData: {} as never,
		});

		setImmediate(() => mockWorkers[0].emit('exit', 0));
		const terminatePromise = pool.terminate();

		await expect(first).rejects.toThrow(/terminated/);
		await expect(queued).rejects.toThrow(/terminated/);
		await terminatePromise;
	});

	it('falls back to terminate() when postMessage throws during shutdown', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });
		mockWorkers[0].postMessage = vi.fn().mockImplementation(() => {
			throw new Error('worker pipe closed');
		});

		await pool.terminate();

		expect(mockWorkers[0].terminate).toHaveBeenCalled();
	});

	it('forces termination after the timeout if the worker never exits', async () => {
		vi.useFakeTimers();
		try {
			const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });
			const promise = pool.terminate();

			// Worker never emits 'exit'; the 5s safety net fires terminate().
			await vi.advanceTimersByTimeAsync(5000);
			// terminate() resolves once the fallback finish runs.
			setImmediate(() => mockWorkers[0].emit('exit', 0));
			await vi.runAllTimersAsync();
			await promise;

			expect(mockWorkers[0].terminate).toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects a task immediately when postMessage throws during dispatch', async () => {
		const pool = new WorkerPool({ size: 1, workerPath: '/worker.js' });
		mockWorkers[0].postMessage = vi.fn().mockImplementation(() => {
			throw new Error('dispatch failure');
		});

		await expect(
			pool.run({
				filePath: '/mod.js',
				num: 0,
				total: 1,
				emitter: makeEmitter(),
				initialData: {} as never,
			}),
		).rejects.toThrow('dispatch failure');
	});
});
