import type { UrlEventBus } from '../url-event-bus.js';

import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { runner } from './runner.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

/** Resolved path to the compiled Worker thread entry point ({@link ./worker.ts}). */
const workerPath = path.resolve(__dirname, 'worker.js');

/**
 * Feature flag controlling whether plugin execution uses Worker threads.
 * When `true` (default), each plugin invocation runs in an isolated Worker,
 * providing memory isolation and crash protection. When `false`, the runner
 * executes directly in the main thread (useful for debugging).
 */
const useWorker = true;

/**
 * Parameters for {@link runInWorker}.
 * @template I - Shape of the additional data merged into `workerData`.
 */
export interface RunInWorkerParams<I extends Record<string, unknown>> {
	/** Absolute path to the module to execute in the Worker. */
	readonly filePath: string;
	/** Zero-based index of the current item (for progress display). */
	readonly num: number;
	/** Total number of items in the batch. */
	readonly total: number;
	/** URL event bus; `'url'` messages from the Worker are re-emitted here. */
	readonly emitter: UrlEventBus;
	/** Plugin-specific data to pass to the Worker module. */
	readonly initialData: I;
}

/**
 * Spawns a Worker thread to execute a plugin module and returns its result.
 *
 * This is the bridge between the main thread's `deal()` parallelism and the
 * per-page Worker execution. Each call creates a new Worker, passes the
 * initial data via `workerData`, and listens for messages until the Worker
 * signals completion.
 *
 * ## Why Worker threads?
 *
 * DOM-heavy plugins (JSDOM + axe-core, markuplint, etc.) allocate significant
 * memory per page. Running them in Workers ensures:
 * - **Memory isolation**: JSDOM windows are fully GC'd when the Worker exits
 * - **Crash containment**: A plugin segfault/OOM kills only the Worker, not the process
 * - **Signal handling**: Graceful cleanup on SIGABRT, SIGQUIT, and other signals
 *
 * ## Message protocol
 *
 * The Worker sends two types of messages:
 * - `{ type: 'url', url: string }` - URL discovery notification, forwarded to the emitter
 * - `{ type: 'finish', result: R }` - Execution complete, resolves the Promise
 *
 * ## Fallback mode
 *
 * When `useWorker` is `false`, execution delegates directly to
 * {@link ./runner.ts!runner} in the main thread.
 * @template I - Shape of the additional data merged into `workerData`.
 * @template R - Return type expected from the Worker module.
 * @param params - Parameters containing file path, progress info, emitter, and data.
 * @returns The result produced by the Worker module's default export.
 * @see {@link ./worker.ts} for the Worker-side entry point
 * @see {@link ./runner.ts!runner} for the direct (non-Worker) execution path
 */
export function runInWorker<I extends Record<string, unknown>, R>(
	params: RunInWorkerParams<I>,
) {
	const { filePath, num, total, emitter, initialData } = params;
	if (useWorker) {
		const worker = new Worker(workerPath, {
			workerData: {
				filePath,
				num,
				total,
				...initialData,
			},
		});
		return new Promise<R>((resolve, reject) => {
			const killWorker = async (sig: NodeJS.Signals) => {
				await worker.terminate();
				worker.unref();
				worker.removeAllListeners();

				process.removeListener('SIGABRT', killWorker);
				process.removeListener('SIGLOST', killWorker);
				process.removeListener('SIGQUIT', killWorker);
				process.removeListener('disconnect', killWorker);
				process.removeListener('exit', killWorker);
				process.removeListener('uncaughtException', killWorker);
				process.removeListener('uncaughtExceptionMonitor', killWorker);
				process.removeListener('unhandledRejection', killWorker);

				// eslint-disable-next-line no-console
				console.log(`Kill Worker cause: %O`, sig);
				reject(`SIG: ${sig}`);
			};

			// Changed from old issue
			// @see https://github.com/nodejs/node-v0.x-archive/issues/6339
			// process.once('SIGKILL', killWorker);
			// process.once('SIGSTOP', killWorker);

			process.once('SIGABRT', killWorker);
			process.once('SIGLOST', killWorker);
			process.once('SIGQUIT', killWorker);
			process.once('disconnect', killWorker);
			process.once('exit', killWorker);
			process.once('uncaughtException', killWorker);
			process.once('uncaughtExceptionMonitor', killWorker);
			process.once('unhandledRejection', killWorker);
			worker.once('error', killWorker);
			worker.once('messageerror', killWorker);

			worker.on('message', async (message) => {
				if (!message) {
					return;
				}
				if (message.type === 'url') {
					void emitter.emit('url', message.url);
				}
				if (message.type === 'finish') {
					await worker.terminate();
					worker.removeAllListeners();
					worker.unref();
					process.removeListener('SIGABRT', killWorker);
					process.removeListener('SIGLOST', killWorker);
					process.removeListener('SIGQUIT', killWorker);
					process.removeListener('disconnect', killWorker);
					process.removeListener('exit', killWorker);
					process.removeListener('uncaughtException', killWorker);
					process.removeListener('uncaughtExceptionMonitor', killWorker);
					process.removeListener('unhandledRejection', killWorker);
					resolve(message.result);
				}
			});
		});
	}

	return runner<I, R>(
		{
			filePath,
			num,
			total,
			...initialData,
		},
		emitter,
	);
}
