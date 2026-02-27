import type { WorkerData } from './types.js';
import type { UrlEventBus } from '../url-event-bus.js';

/**
 * Dynamically imports and executes a plugin worker module.
 *
 * This function is the final execution step in the worker pipeline:
 * 1. It `import()`s the module specified by `data.filePath`
 * 2. Calls the module's default export with the remaining data, emitter,
 *    and progress counters
 * 3. Returns the result
 *
 * The `filePath` field is deleted from `data` before passing it to the
 * module function, so the module only receives its own domain-specific data.
 *
 * This function is called both from the Worker thread ({@link ./worker.ts})
 * and as a direct fallback when `useWorker` is `false` in {@link ./run-in-worker.ts}.
 * @template I - Shape of the caller's initial data (minus the worker infrastructure fields).
 * @template R - Return type of the plugin module's default export.
 * @param data - Combined worker data containing the module path and plugin-specific payload.
 * @param emitter - Event emitter for URL discovery notifications (forwarded to the plugin).
 * @returns The result produced by the dynamically imported module.
 * @see {@link ./types.ts!WorkerData} for the data shape
 * @see {@link ../page-analysis-worker.ts} for a typical module loaded by this runner
 */
export async function runner<I extends Record<string, unknown>, R>(
	data: WorkerData<I>,
	emitter: UrlEventBus,
): Promise<R> {
	const { filePath, num, total } = data;

	const mod = await import(filePath);
	const fn = mod.default;
	// @ts-expect-error
	delete data.filePath;
	const result = await fn(data, emitter, num, total);
	return result;
}
