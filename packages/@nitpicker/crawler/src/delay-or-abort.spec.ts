import { afterEach, describe, expect, it, vi } from 'vitest';

import { delayOrAbort } from './delay-or-abort.js';

describe('delayOrAbort', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('resolves after the given delay when never aborted', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		let resolved = false;
		const promise = delayOrAbort(1000, controller.signal).then(() => {
			resolved = true;
		});

		await vi.advanceTimersByTimeAsync(999);
		expect(resolved).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(resolved).toBe(true);
		await promise;
	});

	it('resolves immediately when the signal aborts before the delay elapses', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		let resolved = false;
		const promise = delayOrAbort(300_000, controller.signal).then(() => {
			resolved = true;
		});

		await vi.advanceTimersByTimeAsync(1000);
		expect(resolved).toBe(false);

		controller.abort();
		await promise;
		expect(resolved).toBe(true);
	});

	it('resolves immediately when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(delayOrAbort(300_000, controller.signal)).resolves.toBeUndefined();
	});

	it('clears the underlying timer on abort instead of leaving it pending (no leaked timer)', async () => {
		vi.useFakeTimers();
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const controller = new AbortController();

		const promise = delayOrAbort(300_000, controller.signal);
		controller.abort();
		await promise;

		expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
		// No pending timer left in the fake-timer queue — advancing to (and
		// past) the original delay must not throw or trigger anything.
		expect(vi.getTimerCount()).toBe(0);
		clearTimeoutSpy.mockRestore();
	});

	it('removes its abort listener once the delay elapses naturally (no leaked listener)', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener');

		const promise = delayOrAbort(1000, controller.signal);
		await vi.advanceTimersByTimeAsync(1000);
		await promise;

		expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
	});
});
