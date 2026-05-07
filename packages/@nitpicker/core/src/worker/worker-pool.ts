import type { UrlEventBus } from '../url-event-bus.js';

import { Worker } from 'node:worker_threads';

/**
 * Per-task payload sent into the pool's `run()` method.
 * @template I - Shape of the per-task data merged into the worker message.
 */
export interface PoolTaskParams<I extends Record<string, unknown>> {
	/** Absolute path to the module to dynamically import inside the worker. */
	readonly filePath: string;
	/** Zero-based index of the current item (for progress display). */
	readonly num: number;
	/** Total number of items in the batch (for progress display). */
	readonly total: number;
	/** Event bus to receive `'url'` events forwarded from the worker. */
	readonly emitter: UrlEventBus;
	/** Plugin-specific data delivered to the dynamically imported module. */
	readonly initialData: I;
}

/** Internal record of an in-flight task awaiting a worker response. */
interface PendingTask {
	/** Unique identifier matched against `taskId` in worker responses. */
	readonly taskId: number;
	/** Caller-supplied event bus for `'url'` notifications. */
	readonly emitter: UrlEventBus;
	/** Resolves with the worker's `result` payload. */
	readonly resolve: (value: unknown) => void;
	/** Rejects when the worker reports an error or dies. */
	readonly reject: (reason: unknown) => void;
}

/** Pool slot that owns a worker thread and tracks its current task. */
interface PoolSlot {
	/** The Node.js Worker thread instance. */
	worker: Worker;
	/** Currently running task, or `null` if the slot is idle. */
	current: PendingTask | null;
}

/** Constructor options for {@link WorkerPool}. */
export interface WorkerPoolOptions {
	/** Number of long-lived worker threads to maintain. Must be >= 1. */
	readonly size: number;
	/** Absolute path to the worker entry script (compiled `worker.js`). */
	readonly workerPath: string;
}

/**
 * Long-lived pool of Worker threads that share execution across many tasks.
 *
 * Replaces the previous "one worker per page" model where every analyzed page
 * paid the cost of spawning a new V8 isolate, importing JSDOM, importing the
 * plugin module, and tearing it all down. With the pool, each worker is
 * created once at the start of an analyze run and processes tasks via
 * message passing until the pool is terminated.
 *
 * ## Why this matters
 *
 * On a 750-page archive with `CONCURRENCY_LIMIT = 50`, the old model spawned
 * 50 workers nearly simultaneously and repeated this every time a worker
 * finished, producing recurring "boot waves" that drove peak memory above
 * 20GB. The pool model performs N initial boots and then reuses those V8
 * isolates for the rest of the run, eliminating the recurring cost entirely.
 *
 * ## Message protocol (Pool ↔ Worker)
 *
 * | Direction        | `type`        | Payload                          |
 * |------------------|---------------|----------------------------------|
 * | Pool → Worker    | `'task'`      | `{ taskId, data }`               |
 * | Pool → Worker    | `'shutdown'`  | (none)                           |
 * | Worker → Pool    | `'url'`       | `{ taskId, url }` (forwarded)    |
 * | Worker → Pool    | `'result'`    | `{ taskId, result, error? }`     |
 *
 * Each task carries a unique numeric `taskId` so that responses and URL
 * notifications from a worker can be routed back to the correct caller.
 */
export class WorkerPool {
	/** FIFO queue of slots ready to accept a task. */
	#idle: PoolSlot[] = [];
	/** Tasks awaiting their result, keyed by taskId. */
	#inFlight = new Map<number, PendingTask>();
	/** Monotonic task identifier source. */
	#nextTaskId = 0;
	/** FIFO queue of pending tasks waiting for an idle slot. */
	#queue: PendingTask[] = [];
	/** Once `terminate()` has been called, no new tasks may be submitted. */
	#shuttingDown = false;
	/** All worker slots, idle or busy. */
	#slots: PoolSlot[] = [];

	/** Per-task data payload to send when a queued task is dispatched. */
	#taskData = new Map<number, Record<string, unknown>>();

	/** Worker entry script path; reused when replacing crashed workers. */
	readonly #workerPath: string;

	/**
	 * Constructs a pool with the given size and worker entry script.
	 * @param options - Pool size and worker entry script path.
	 */
	constructor(options: WorkerPoolOptions) {
		const size = Math.max(1, Math.floor(options.size));
		this.#workerPath = options.workerPath;
		for (let i = 0; i < size; i++) {
			this.#spawn();
		}
	}

	/**
	 * Submits a task to the pool. Resolves with the worker's `result` payload
	 * once a worker has finished processing it. The task may be queued if all
	 * workers are currently busy.
	 * @template I - Shape of the per-task `initialData` payload.
	 * @template R - Expected result type returned by the worker module.
	 * @param params - Task payload (file path, batch indices, emitter, data).
	 * @returns The worker's result.
	 */
	run<I extends Record<string, unknown>, R>(params: PoolTaskParams<I>): Promise<R> {
		if (this.#shuttingDown) {
			return Promise.reject(new Error('WorkerPool is shutting down'));
		}

		const taskId = this.#nextTaskId++;
		const data = {
			filePath: params.filePath,
			num: params.num,
			total: params.total,
			...params.initialData,
		};

		return new Promise<R>((resolve, reject) => {
			const task: PendingTask = {
				taskId,
				emitter: params.emitter,
				resolve: resolve as (value: unknown) => void,
				reject,
			};
			this.#taskData.set(taskId, data);
			const slot = this.#idle.shift();
			if (slot) {
				this.#dispatch(slot, task);
				return;
			}
			this.#queue.push(task);
		});
	}

	/**
	 * Rejects every queued or in-flight task, sends each worker a `shutdown`
	 * message, and awaits its exit. After this call returns, no further
	 * submissions are accepted.
	 *
	 * Pending tasks are rejected synchronously so callers waiting on
	 * `pool.run()` Promises do not hang. Workers handle the shutdown message
	 * by exiting cleanly; if that fails, {@link #shutdownSlot} forces
	 * termination after a 5 second timeout.
	 */
	async terminate() {
		this.#shuttingDown = true;
		const pendingError = new Error('WorkerPool terminated before task completed');
		for (const task of this.#queue) {
			task.reject(pendingError);
			this.#taskData.delete(task.taskId);
		}
		this.#queue = [];
		for (const task of this.#inFlight.values()) {
			task.reject(pendingError);
		}
		this.#inFlight.clear();
		await Promise.all(this.#slots.map((slot) => this.#shutdownSlot(slot)));
		this.#slots = [];
		this.#idle = [];
	}

	/**
	 * Completes the current task on `slot` and dispatches the next queued task.
	 * @param slot
	 * @param taskId
	 * @param result
	 * @param error
	 */
	#completeTask(
		slot: PoolSlot,
		taskId: number,
		result: unknown,
		error: string | undefined,
	) {
		const task = this.#inFlight.get(taskId);
		this.#inFlight.delete(taskId);
		slot.current = null;

		if (task) {
			if (error) {
				task.reject(new Error(error));
			} else {
				task.resolve(result);
			}
		}

		const next = this.#queue.shift();
		if (next) {
			this.#dispatch(slot, next);
		} else {
			this.#idle.push(slot);
		}
	}
	/**
	 * Sends a queued task to an idle slot and registers it as in-flight.
	 *
	 * If `postMessage` throws (e.g. the worker died between handoff and
	 * dispatch), the task is rejected immediately and the slot is left out
	 * of the idle pool so the worker's `error` event can replace it via
	 * {@link #onWorkerCrash}.
	 * @param slot - Pool slot that owns the worker.
	 * @param task - Pending task to dispatch.
	 */
	#dispatch(slot: PoolSlot, task: PendingTask) {
		const data = this.#taskData.get(task.taskId);
		try {
			slot.worker.postMessage({ type: 'task', taskId: task.taskId, data });
		} catch (error) {
			this.#taskData.delete(task.taskId);
			task.reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		slot.current = task;
		this.#inFlight.set(task.taskId, task);
		this.#taskData.delete(task.taskId);
	}
	/**
	 * Routes an incoming worker message to the matching pending task.
	 * @param slot
	 * @param message
	 */
	#onMessage(slot: PoolSlot, message: unknown) {
		if (!message || typeof message !== 'object') {
			return;
		}
		const msg = message as {
			type?: string;
			taskId?: number;
			url?: string;
			result?: unknown;
			error?: string;
		};
		if (
			msg.type === 'url' &&
			typeof msg.taskId === 'number' &&
			typeof msg.url === 'string'
		) {
			const task = this.#inFlight.get(msg.taskId);
			if (task) {
				void task.emitter.emit('url', msg.url);
			}
			return;
		}
		if (msg.type === 'result' && typeof msg.taskId === 'number') {
			this.#completeTask(slot, msg.taskId, msg.result, msg.error);
			return;
		}
	}
	/**
	 * Handles an unrecoverable worker failure: rejects the current task,
	 * removes the dead slot, and spawns a replacement so the pool keeps its
	 * configured size. Queued tasks are picked up by the new slot when ready.
	 * @param slot
	 * @param error
	 */
	#onWorkerCrash(slot: PoolSlot, error: unknown) {
		const task = slot.current;
		slot.current = null;
		if (task) {
			this.#inFlight.delete(task.taskId);
			task.reject(error instanceof Error ? error : new Error(String(error)));
		}
		const slotIndex = this.#slots.indexOf(slot);
		if (slotIndex !== -1) {
			this.#slots.splice(slotIndex, 1);
		}
		const idleIndex = this.#idle.indexOf(slot);
		if (idleIndex !== -1) {
			this.#idle.splice(idleIndex, 1);
		}
		slot.worker.removeAllListeners();
		void slot.worker.terminate();

		if (this.#shuttingDown) {
			return;
		}

		const replacement = this.#spawn();
		const next = this.#queue.shift();
		if (next) {
			const idleIdx = this.#idle.indexOf(replacement);
			if (idleIdx !== -1) {
				this.#idle.splice(idleIdx, 1);
			}
			this.#dispatch(replacement, next);
		}
	}
	/**
	 * Sends a shutdown message and waits for the worker to exit cleanly.
	 * @param slot
	 */
	#shutdownSlot(slot: PoolSlot) {
		return new Promise<void>((resolve) => {
			const finish = () => {
				slot.worker.removeAllListeners();
				resolve();
			};
			slot.worker.once('exit', finish);
			slot.worker.once('error', finish);
			try {
				slot.worker.postMessage({ type: 'shutdown' });
			} catch {
				void slot.worker.terminate().finally(finish);
				return;
			}
			// Safety net in case the worker fails to acknowledge the shutdown.
			setTimeout(() => {
				void slot.worker.terminate().finally(finish);
			}, 5000).unref();
		});
	}
	/** Spawns a fresh worker, wires up its event handlers, and adds it to the pool. */
	#spawn(): PoolSlot {
		const worker = new Worker(this.#workerPath);
		const slot: PoolSlot = { worker, current: null };
		this.#slots.push(slot);

		worker.on('message', (message) => {
			this.#onMessage(slot, message);
		});
		worker.on('error', (error) => {
			this.#onWorkerCrash(slot, error);
		});
		worker.on('messageerror', (error) => {
			this.#onWorkerCrash(slot, error);
		});

		this.#idle.push(slot);
		// Workers should not keep the event loop alive on their own;
		// the pool's terminate() controls their lifetime.
		worker.unref();
		return slot;
	}
}
