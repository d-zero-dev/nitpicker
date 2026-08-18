import type { ViewerReadModelWorkerData, ViewerReadModelWorkerMessage } from './types.js';
import type { BuildViewerReadModelOptions } from '../../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

/**
 * Absolute path to the compiled worker entry. Resolved relative to this
 * module so it points at the sibling `lib/` file at runtime (same technique
 * as `@nitpicker/core`'s worker path resolution) — the entry is an internal
 * implementation detail and is deliberately absent from the package
 * `exports`.
 */
const WORKER_ENTRY_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'viewer-read-model-worker-entry.js',
);

/**
 * Shared main-thread plumbing for the one-shot viewer-read-model worker:
 * spawns the entry with the given task, relays its `phase`/`progress`
 * messages to the caller's callbacks, and settles on the first terminal
 * outcome. The public faces are `buildViewerReadModelInWorker` and
 * `runViewerReadModelBackfillsInWorker` — this exists so the two don't
 * duplicate the lifecycle handling.
 *
 * Rejects — never resolves silently — on all three failure routes: the task
 * throwing inside the worker (relayed as an `error` message), the worker
 * itself erroring (failed spawn, uncaught module-scope throw), and the
 * worker exiting before reporting completion.
 * @param accessor - The writable accessor whose `tmpDir` the worker
 *   reconnects to. Enforced eagerly, before any thread is spawned.
 * @param task - Which job the worker performs — see
 *   {@link ViewerReadModelWorkerData.task}.
 * @param options - `onPhase`/`onProgress` callbacks, invoked on the calling
 *   thread as worker messages arrive.
 * @throws {Error} When `accessor.readOnly` is `true`, or when the worker
 *   task fails via any of the three routes above.
 * @example
 * await runViewerReadModelWorkerTask(archive, 'build', { onPhase });
 */
export async function runViewerReadModelWorkerTask(
	accessor: ArchiveAccessor,
	task: ViewerReadModelWorkerData['task'],
	options: BuildViewerReadModelOptions = {},
): Promise<void> {
	if (accessor.readOnly) {
		throw new Error(
			`runViewerReadModelWorkerTask: cannot run the '${task}' task on a ` +
				'read-only ArchiveAccessor (stub-mode, or a read-only accessor opened via ' +
				'Archive.connect / Archive.openCached). The viewer read model may only be ' +
				'mutated through a writable Archive (Archive.create / Archive.open), ' +
				'typically from the crawl-completion step.',
		);
	}
	const { onPhase, onProgress } = options;
	const workerDataPayload: ViewerReadModelWorkerData = { tmpDir: accessor.tmpDir, task };
	await new Promise<void>((resolve, reject) => {
		const worker = new Worker(WORKER_ENTRY_PATH, { workerData: workerDataPayload });
		// One terminal outcome only: the entry posts done/error and then exits,
		// so a normal run fires both a message and an 'exit' — the flag makes
		// whichever arrives first win. Listeners stay attached after settling
		// (no removeAllListeners): the worker is one-shot and unreachable after
		// exit anyway, and detaching the 'error' listener would turn a late
		// error event into an EventEmitter unhandled-'error' crash.
		let settled = false;
		const settleResolve = () => {
			if (settled) {
				return;
			}
			settled = true;
			resolve();
		};
		const settleReject = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			reject(error);
		};
		worker.on('message', (message: ViewerReadModelWorkerMessage) => {
			switch (message.type) {
				case 'phase': {
					onPhase?.(message.phase);
					return;
				}
				case 'progress': {
					onProgress?.(message.progress);
					return;
				}
				case 'done': {
					settleResolve();
					return;
				}
				case 'error': {
					settleReject(new Error(message.message));
					return;
				}
			}
		});
		worker.on('error', (error) => {
			if (settled) {
				// Late 'error' after 'done'/'error' message or 'exit' already
				// settled the promise — the caller can no longer observe this via
				// the rejection, so surface it instead of dropping it silently
				// (the `settled` guard exists to make late 'exit' events, which
				// fire on every normal run, harmless; a late worker-level error
				// is not that — it is unexpected).
				// eslint-disable-next-line no-console -- last-resort surface for an event no promise can relay anymore
				console.warn(
					`viewer read model worker '${task}' emitted an error after already settling: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}
			settleReject(error instanceof Error ? error : new Error(String(error)));
		});
		worker.on('exit', (code) => {
			settleReject(
				new Error(
					`viewer read model worker exited before completing the '${task}' task (exit code ${code})`,
				),
			);
		});
	});
}
