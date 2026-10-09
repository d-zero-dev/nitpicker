import { log } from '../debug.js';

/**
 * Debug logger for the ErrorEmitter helper family.
 * Namespace: `Nitpicker:Utils:ErrorEmitter`. Kept identical to the namespace
 * used by the deleted `@ErrorEmitter()` decorator so existing `DEBUG` env
 * filters keep working after the decorator-to-HOF migration.
 */
const errorLog = log.extend('ErrorEmitter');

/**
 * Minimal object shape required by {@link emitError}: an emitter able to
 * publish an `'error'` event carrying an `Error` payload. Any class that
 * extends `TypedAwaitEventEmitter<{ error: Error, ... }>` satisfies this,
 * and so does Node's built-in `EventEmitter`.
 */
interface Emitter {
	/**
	 * Emits the `'error'` event with the given `Error` payload.
	 * The return value is intentionally unspecified — callers ignore it.
	 * @param event - Event name; always `'error'` here.
	 * @param payload - The error instance to publish.
	 * @returns Anything; the caller ignores it.
	 */
	emit(event: 'error', payload: Error): unknown;
}

/**
 * Wraps `fn` so that any thrown `Error` is logged with `label` and
 * re-emitted as an `'error'` event on `emitter` before being re-thrown.
 * Non-`Error` throws pass through unchanged — no log, no emit — matching
 * the behaviour of the deleted `@ErrorEmitter()` decorator so that
 * downstream `'error'` listeners (e.g. the crawler orchestrator that
 * aborts on any emitted error) are only invoked with real `Error`
 * instances.
 *
 * Kept as a standalone HOF (instead of a decorator) because Vite 8 /
 * Vitest 4.1 switched from esbuild to Rolldown + oxc, which emit
 * TC39 Stage 3 decorator syntax as-is and let it reach Node, causing
 * `SyntaxError: Invalid or unexpected token` at test runtime.
 * @template T - The return type of `fn`.
 * @param emitter - The event emitter that receives the `'error'` event.
 * @param label - Human-readable label included in the debug log line
 *                (typically `'ClassName.methodName'`). Also useful as the
 *                grep target when triaging failed crawls.
 * @param fn - The async operation to wrap.
 * @returns The resolved value of `fn`.
 */
export async function emitError<T>(
	emitter: Emitter,
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	try {
		return await fn();
	} catch (error: unknown) {
		if (error instanceof Error) {
			errorLog('%s: %O', label, error);
			void emitter.emit('error', error);
		}
		throw error;
	}
}
