import type { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';

import { log } from '../debug.js';

const errorLog = log.extend('ErrorEmitter');

/**
 * Event payload type for error events emitted by classes using the {@link ErrorEmitter} decorator.
 * @template E - The specific error type, defaults to `Error`.
 */
export type ErrorEvent<E extends Error = Error> = {
	/** The error instance that was caught. */
	error: E;
};

/**
 * A class method decorator factory that wraps the decorated method with error handling.
 * When the method throws an `Error`, it emits an `'error'` event on the class instance
 * (which must extend {@link EventEmitter}) with the caught error, then re-throws the error.
 * @template C - The class type, which must be an EventEmitter capable of emitting error events.
 * @template E - The error event type, defaults to {@link ErrorEvent}.
 * @returns A decorator function that wraps the target method with error-emitting behavior.
 */
export function ErrorEmitter<
	C extends EventEmitter<E>,
	E extends ErrorEvent = ErrorEvent,
>() {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	return (method: Function, context: ClassMethodDecoratorContext) => {
		return async function (this: C, ...args: unknown[]) {
			const constructorName = String(this.constructor?.name || this.constructor || this);
			const methodName = `${constructorName}.${String(context.name)}`;
			try {
				return await method.apply(this, args);
			} catch (error: unknown) {
				if (error instanceof Error) {
					errorLog('%s: %O', methodName, error);
					void this.emit('error', error);
				}
				throw error;
			}
		};
	};
}
