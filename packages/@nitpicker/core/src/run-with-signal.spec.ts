import { describe, it, expect, vi, beforeEach } from 'vitest';

const tokens = vi.hoisted(() => [] as { cancel: ReturnType<typeof vi.fn> }[]);

vi.mock('./native-binding.js', () => ({
	nativeBinding: {
		NativeCancelToken: class {
			cancel = vi.fn();
			constructor() {
				tokens.push(this);
			}
		},
	},
}));

const { runWithSignal } = await import('./run-with-signal.js');

/**
 * What the addon rejects with for a call stopped through its token.
 */
function cancelledByAddon(): Error {
	return Object.assign(new Error('match-selector judging was cancelled'), {
		code: 'Cancelled',
	});
}

describe('runWithSignal', () => {
	beforeEach(() => {
		tokens.length = 0;
	});

	it('runs the call with no token when there is no signal', async () => {
		const run = vi.fn(() => Promise.resolve('done'));
		await expect(runWithSignal(undefined, run)).resolves.toBe('done');
		expect(run).toHaveBeenCalledWith();
		expect(tokens).toHaveLength(0);
	});

	it('rejects with the reason of a signal that is already aborted, without calling the addon', async () => {
		const reason = new Error('stopped before it began');
		const run = vi.fn(() => Promise.resolve('done'));
		await expect(runWithSignal(AbortSignal.abort(reason), run)).rejects.toBe(reason);
		expect(run).not.toHaveBeenCalled();
		expect(tokens).toHaveLength(0);
	});

	it('raises the token when the signal aborts, and rejects with the signal reason', async () => {
		const controller = new AbortController();
		const reason = new Error('client went away');
		const outcome = runWithSignal(controller.signal, (token) => {
			expect(token).toBe(tokens[0]);
			return new Promise<string>((_, reject) => {
				tokens[0]!.cancel.mockImplementation(() => reject(cancelledByAddon()));
			});
		});
		controller.abort(reason);
		await expect(outcome).rejects.toBe(reason);
		expect(tokens[0]!.cancel).toHaveBeenCalledTimes(1);
	});

	it('does not replace a failure that is not a cancellation', async () => {
		const controller = new AbortController();
		const failure = new Error('snapshot 3 could not be decoded: corrupt');
		const outcome = runWithSignal(controller.signal, () => Promise.reject(failure));
		controller.abort(new Error('abort'));
		await expect(outcome).rejects.toBe(failure);
	});

	it('does not replace a cancellation the signal did not ask for', async () => {
		const failure = cancelledByAddon();
		await expect(
			runWithSignal(new AbortController().signal, () => Promise.reject(failure)),
		).rejects.toBe(failure);
	});

	it('stops listening once the call has settled', async () => {
		const controller = new AbortController();
		await runWithSignal(controller.signal, () => Promise.resolve('done'));
		controller.abort();
		expect(tokens[0]!.cancel).not.toHaveBeenCalled();
	});
});
