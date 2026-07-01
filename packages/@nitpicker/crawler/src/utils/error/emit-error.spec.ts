import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { emitError } from './emit-error.js';

describe('emitError', () => {
	it('passes through the resolved value on success', async () => {
		const emitter = new EventEmitter();
		emitter.on('error', () => {
			// noop — required so a stray emit does not crash the test
		});
		const result = await emitError(emitter, 'label', () => Promise.resolve(42));
		expect(result).toBe(42);
	});

	it('emits an error event and re-throws when fn throws an Error', async () => {
		const emitter = new EventEmitter();
		const seen: Error[] = [];
		emitter.on('error', (error: Error) => {
			seen.push(error);
		});
		const err = new Error('boom');
		await expect(emitError(emitter, 'label', () => Promise.reject(err))).rejects.toBe(
			err,
		);
		expect(seen).toEqual([err]);
	});

	it('does not emit an error event when fn throws a non-Error', async () => {
		const emitter = new EventEmitter();
		const spy = vi.fn();
		emitter.on('error', spy);
		await expect(
			emitError(emitter, 'label', () => Promise.reject('not an error')),
		).rejects.toBe('not an error');
		expect(spy).not.toHaveBeenCalled();
	});

	it('does not emit an error event on success', async () => {
		const emitter = new EventEmitter();
		const spy = vi.fn();
		emitter.on('error', spy);
		await emitError(emitter, 'label', () => Promise.resolve(1));
		expect(spy).not.toHaveBeenCalled();
	});

	it('emits exactly one error event per thrown Error', async () => {
		const emitter = new EventEmitter();
		emitter.on('error', () => {
			// swallow so vi.spyOn observes the emit without EventEmitter re-throwing
		});
		const spy = vi.spyOn(emitter, 'emit');
		await expect(
			emitError(emitter, 'label', () => Promise.reject(new Error('once'))),
		).rejects.toThrow('once');
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith('error', expect.any(Error));
	});
});
