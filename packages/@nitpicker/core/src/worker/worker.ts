/**
 * Worker thread entry point for plugin execution.
 *
 * This module runs inside a `new Worker(...)` created by the
 * {@link ./worker-pool.ts!WorkerPool}. Unlike the previous one-shot model,
 * each worker is long-lived and processes many tasks via a message loop until
 * it receives a `shutdown` message.
 *
 * ## Message protocol (Worker ↔ Pool)
 *
 * | Direction       | `type`        | Payload                          |
 * |-----------------|---------------|----------------------------------|
 * | Pool → Worker   | `'task'`      | `{ taskId, data }`               |
 * | Pool → Worker   | `'shutdown'`  | (none)                           |
 * | Worker → Pool   | `'url'`       | `{ taskId, url }`                |
 * | Worker → Pool   | `'result'`    | `{ taskId, result, error? }`     |
 *
 * ## Lifecycle
 *
 * 1. Listens on `parentPort` for `task` messages.
 * 2. For each task, delegates to {@link ./runner.ts!runner} which dynamically
 *    `import()`s the module pointed to by `data.filePath`. Subsequent tasks
 *    that target the same module reuse the import cache, so the heavy boot
 *    cost is paid once per module per worker.
 * 3. Posts a `result` message back to the pool and waits for the next task.
 * 4. On `shutdown`, exits the process so the V8 isolate is fully released.
 *
 * The `'url'` events emitted by plugins are forwarded with the active
 * `taskId` so the pool can route them back to the correct caller's emitter.
 * @see {@link ./worker-pool.ts!WorkerPool} for the main-thread counterpart
 * @see {@link ./runner.ts!runner} for the actual module loading logic
 * @module
 */

import { parentPort } from 'node:worker_threads';

import { UrlEventBus } from '../url-event-bus.js';

import { runner } from './runner.js';

/** Identifier for the task currently being processed; used to tag forwarded `'url'` events. */
let currentTaskId: number | null = null;

/** Long-lived event bus that forwards `'url'` events from plugins to the pool. */
const emitter = new UrlEventBus();

emitter.on('url', (url) => {
	if (!parentPort) {
		throw new Error('Use in worker thread');
	}
	if (currentTaskId === null) {
		return;
	}
	parentPort.postMessage({
		type: 'url',
		taskId: currentTaskId,
		url,
	});
});

if (!parentPort) {
	throw new Error('Use in worker thread');
}

parentPort.on('message', (message) => {
	if (!message || typeof message !== 'object') {
		return;
	}
	const msg = message as {
		type?: string;
		taskId?: number;
		data?: Record<string, unknown>;
	};
	if (msg.type === 'shutdown') {
		// Defer to the next tick so any in-flight `postMessage` from the most
		// recent task has a chance to flush before the worker exits.
		setImmediate(() => process.exit(0));
		return;
	}
	if (msg.type === 'task' && typeof msg.taskId === 'number' && msg.data) {
		void runTask(msg.taskId, msg.data);
	}
});

/**
 * Executes a single task and posts the result back to the pool.
 *
 * Errors are caught and reported via the `error` field on the `result` message
 * so the pool can reject the originating Promise without the worker crashing.
 * @param taskId - Identifier echoed back so the pool can match the response.
 * @param data - Payload from the pool, including `filePath` consumed by `runner()`.
 */
async function runTask(taskId: number, data: Record<string, unknown>) {
	currentTaskId = taskId;
	try {
		const result = await runner(data as Parameters<typeof runner>[0], emitter);
		if (!parentPort) {
			throw new Error('Use in worker thread');
		}
		parentPort.postMessage({
			type: 'result',
			taskId,
			result,
		});
	} catch (error) {
		if (!parentPort) {
			throw new Error('Use in worker thread');
		}
		const message = error instanceof Error ? error.message : String(error);
		parentPort.postMessage({
			type: 'result',
			taskId,
			result: null,
			error: message,
		});
	} finally {
		currentTaskId = null;
	}
}
