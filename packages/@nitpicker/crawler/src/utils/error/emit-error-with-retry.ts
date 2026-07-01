import type { RetryCallOptions } from '@d-zero/shared/retry';

import { retryCall } from '@d-zero/shared/retry';

import { log } from '../debug.js';

/**
 * Debug logger for the ErrorEmitter helper family.
 * Namespace: `Nitpicker:Utils:ErrorEmitter`. Kept identical to the namespace
 * used by the deleted `@ErrorEmitter()` decorator so existing `DEBUG` env
 * filters keep working after the decorator-to-HOF migration.
 */
const errorLog = log.extend('ErrorEmitter');

/**
 * Minimal object shape required by {@link emitErrorAndRetry}: an emitter
 * able to publish an `'error'` event carrying an `Error` payload. Same
 * contract as `emitError` — see {@link ./emit-error.js} for details.
 */
interface Emitter {
	/**
	 * Emits the `'error'` event with the given `Error` payload.
	 * @param event - Event name; always `'error'` here.
	 * @param payload - The error instance to publish.
	 * @returns Anything; the caller ignores it.
	 */
	emit(event: 'error', payload: Error): unknown;
}

/**
 * Retries `fn` per `retryOptions`, then — if retries are exhausted with a
 * final `Error` — logs and re-emits it as an `'error'` event on `emitter`
 * before re-throwing. `label` is forwarded into `retryCall` so its own
 * onWait / onGiveUp / timeout messages identify the call site (previously
 * derived automatically by the `@retry` decorator via
 * `ClassMethodDecoratorContext.name`).
 *
 * Inlined try/catch rather than composing {@link emitError} with a
 * `() => retryCall(...)` closure to keep the per-invocation closure count
 * at 1 — this method is called on the DB write hot path (`updatePage`,
 * `insertResource`), where wrapping decorators previously ran with zero
 * per-call allocation.
 * @template T - The return type of `fn`.
 * @param emitter - The event emitter that receives the `'error'` event.
 * @param label - Human-readable label; forwarded into `retryCall`
 *                (visible in retry timeouts / onWait / onGiveUp) and used
 *                as the debug log prefix on final failure.
 * @param fn - The async operation to retry.
 * @param retryOptions - Retry configuration; `label` is overwritten
 *                       with the `label` argument here.
 * @returns The resolved value of `fn`.
 */
export async function emitErrorAndRetry<T>(
	emitter: Emitter,
	label: string,
	fn: () => Promise<T>,
	retryOptions: RetryCallOptions,
): Promise<T> {
	try {
		return await retryCall(fn, { ...retryOptions, label });
	} catch (error: unknown) {
		if (error instanceof Error) {
			errorLog('%s: %O', label, error);
			void emitter.emit('error', error);
		}
		throw error;
	}
}
