/**
 * Worker thread entry point for plugin execution.
 *
 * This module runs inside a `new Worker(...)` created by {@link ./run-in-worker.ts!runInWorker}.
 * It uses a message-based protocol to communicate with the main thread:
 *
 * ## Message protocol (Worker -> Main)
 *
 * | `type`     | Payload          | Description                                    |
 * |------------|------------------|------------------------------------------------|
 * | `'url'`    | `{ url: string }` | A URL was discovered during analysis           |
 * | `'finish'` | `{ result: R }`  | Analysis complete, carries the plugin result   |
 *
 * ## Lifecycle
 *
 * 1. Reads `workerData` containing the module path + plugin data
 * 2. Creates a local {@link ../url-event-bus.ts!UrlEventBus} that forwards `'url'`
 *    events to the main thread via `parentPort.postMessage`
 * 3. Delegates to {@link ./runner.ts!runner} for dynamic import and execution
 * 4. Posts the `'finish'` message with the result
 *
 * The main thread terminates this Worker after receiving `'finish'`.
 * @see {@link ./run-in-worker.ts!runInWorker} for the main-thread counterpart
 * @see {@link ./runner.ts!runner} for the actual module loading logic
 * @module
 */

import type { WorkerData } from './types.js';

import { parentPort, workerData } from 'node:worker_threads';

import { UrlEventBus } from '../url-event-bus.js';

import { runner } from './runner.js';

const data: WorkerData<Record<string, unknown>> = workerData;

const emitter = new UrlEventBus();

/**
 * Forward URL discovery events from the plugin to the main thread.
 * The main thread's {@link ../url-event-bus.ts!UrlEventBus} re-emits these
 * so that the orchestrator can track discovered URLs.
 */
emitter.on('url', (url) => {
	if (!parentPort) {
		throw new Error('Use in worker thread');
	}
	parentPort.postMessage({
		type: 'url',
		url,
	});
});

const result = await runner(data, emitter);

if (!parentPort) {
	throw new Error('Use in worker thread');
}

parentPort.postMessage({
	type: 'finish',
	result,
});
