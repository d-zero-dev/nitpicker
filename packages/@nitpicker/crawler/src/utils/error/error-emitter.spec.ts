import type { ErrorEvent } from './error-emitter.js';

import { TypedAwaitEventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import { describe, it, expect, vi } from 'vitest';

import { ErrorEmitter } from './error-emitter.js';

/**
 * Test class that uses the ErrorEmitter decorator.
 */
class TestEmitter extends TypedAwaitEventEmitter<ErrorEvent> {
	/**
	 * A method that throws an Error.
	 * @param message - Error message.
	 */
	@ErrorEmitter()
	failWithError(message: string): Promise<never> {
		throw new Error(message);
	}
	/**
	 * A method that throws a non-Error value.
	 */
	@ErrorEmitter()
	failWithNonError(): Promise<never> {
		throw 'string-error';
	}
	/**
	 * A method that succeeds.
	 * @param value - A value to return.
	 * @returns The input value.
	 */
	@ErrorEmitter()
	succeed(value: string): Promise<string> {
		return Promise.resolve(value);
	}
}

describe('ErrorEmitter', () => {
	it('returns the method result on success', async () => {
		const emitter = new TestEmitter();
		const result = await emitter.succeed('hello');
		expect(result).toBe('hello');
	});

	it('emits an error event when the method throws an Error', async () => {
		const emitter = new TestEmitter();
		const listener = vi.fn();
		emitter.on('error', listener);

		await expect(emitter.failWithError('test failure')).rejects.toThrow('test failure');
		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith(expect.any(Error));
		expect(listener.mock.calls[0][0].message).toBe('test failure');
	});

	it('re-throws the error after emitting', async () => {
		const emitter = new TestEmitter();
		await expect(emitter.failWithError('boom')).rejects.toThrow('boom');
	});

	it('does not emit error event for non-Error throws', async () => {
		const emitter = new TestEmitter();
		const listener = vi.fn();
		emitter.on('error', listener);

		await expect(emitter.failWithNonError()).rejects.toBe('string-error');
		expect(listener).not.toHaveBeenCalled();
	});

	it('does not emit error event on success', async () => {
		const emitter = new TestEmitter();
		const listener = vi.fn();
		emitter.on('error', listener);

		await emitter.succeed('ok');
		expect(listener).not.toHaveBeenCalled();
	});
});
