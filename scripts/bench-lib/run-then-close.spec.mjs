import { describe, it, expect, vi } from 'vitest';

import { runThenClose } from './run-then-close.mjs';

describe('runThenClose', () => {
	it('closes after the work succeeds and returns its value', async () => {
		const close = vi.fn(async () => {});
		await expect(runThenClose(async () => 'result', close)).resolves.toBe('result');
		expect(close).toHaveBeenCalledOnce();
	});

	it('closes after the work fails and rethrows the work error', async () => {
		const close = vi.fn(async () => {});
		await expect(
			runThenClose(async () => {
				throw new Error('work failed');
			}, close),
		).rejects.toThrow('work failed');
		expect(close).toHaveBeenCalledOnce();
	});

	it('keeps the work error when the cleanup fails too, and reports the cleanup error', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(
			runThenClose(
				async () => {
					throw new Error('work failed');
				},
				async () => {
					throw new Error('close failed');
				},
			),
		).rejects.toThrow('work failed');
		expect(consoleError).toHaveBeenCalledWith(
			'cleanup after a failure also failed:',
			new Error('close failed'),
		);
		consoleError.mockRestore();
	});

	it('rejects with the cleanup error when only the cleanup fails', async () => {
		await expect(
			runThenClose(
				async () => 'result',
				async () => {
					throw new Error('close failed');
				},
			),
		).rejects.toThrow('close failed');
	});
});
