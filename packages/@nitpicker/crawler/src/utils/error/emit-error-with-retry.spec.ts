import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { emitErrorAndRetry } from './emit-error-with-retry.js';

const noRetry = { retries: 1, interval: 0, withExponentialBackoff: false } as const;
const threeAttempts = { retries: 3, interval: 0, withExponentialBackoff: false } as const;

describe('emitErrorAndRetry', () => {
	it('passes through the resolved value on success (no retry needed)', async () => {
		const emitter = new EventEmitter();
		emitter.on('error', () => {
			// noop
		});
		const result = await emitErrorAndRetry(
			emitter,
			'label',
			() => Promise.resolve(42),
			noRetry,
		);
		expect(result).toBe(42);
	});

	it('retries a transient failure and returns the eventual success value', async () => {
		const emitter = new EventEmitter();
		emitter.on('error', () => {
			// noop
		});
		let attempts = 0;
		const result = await emitErrorAndRetry(
			emitter,
			'label',
			() => {
				attempts++;
				if (attempts < 2) {
					return Promise.reject(new Error('transient'));
				}
				return Promise.resolve('ok');
			},
			threeAttempts,
		);
		expect(attempts).toBe(2);
		expect(result).toBe('ok');
	});

	it('emits an error event exactly once after retries are exhausted', async () => {
		const emitter = new EventEmitter();
		const seen: Error[] = [];
		emitter.on('error', (error: Error) => {
			seen.push(error);
		});
		let attempts = 0;
		await expect(
			emitErrorAndRetry(
				emitter,
				'label',
				() => {
					attempts++;
					return Promise.reject(new Error('permanent'));
				},
				threeAttempts,
			),
		).rejects.toThrow('permanent');
		expect(attempts).toBe(3);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.message).toContain('permanent');
	});

	it('does not emit an error event when the final throw is a non-Error', async () => {
		const emitter = new EventEmitter();
		const spy = vi.fn();
		emitter.on('error', spy);
		await expect(
			emitErrorAndRetry(
				emitter,
				'label',

				() => Promise.reject('not an error'),
				noRetry,
			),
		).rejects.toBe('not an error');
		expect(spy).not.toHaveBeenCalled();
	});

	it('forwards the label to the onWait callback on every retry', async () => {
		const emitter = new EventEmitter();
		emitter.on('error', () => {
			// noop
		});
		const observedLabels: string[] = [];
		await expect(
			emitErrorAndRetry(
				emitter,
				'Database.getPages',
				() => Promise.reject(new Error('transient')),
				{
					retries: 3,
					interval: 1,
					withExponentialBackoff: false,
					onWait: (_interval, _count, label) => {
						observedLabels.push(label);
					},
				},
			),
		).rejects.toThrow();
		// With retries=3 the retry loop calls onWait once per failed attempt
		// (3 failures → 3 onWait invocations); label must be the caller-passed
		// value on every call, not the stale `label` in the retryOptions.
		expect(observedLabels).toEqual([
			'Database.getPages',
			'Database.getPages',
			'Database.getPages',
		]);
	});

	it('overrides the label field of retryOptions with the passed label', async () => {
		const emitter = new EventEmitter();
		emitter.on('error', () => {
			// noop
		});
		let observedLabel: string | undefined;
		await expect(
			emitErrorAndRetry(
				emitter,
				'Database.getAnchorsOnPage',
				() => Promise.reject(new Error('boom')),
				{
					...noRetry,
					label: 'stale label from options',
					onGiveUp: (_count, _error, label) => {
						observedLabel = label;
					},
				},
			),
		).rejects.toThrow('boom');
		expect(observedLabel).toBe('Database.getAnchorsOnPage');
	});
});
