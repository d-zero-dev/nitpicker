import type { ClosableBrowser } from './close-browser-safely.js';
import type { Browser } from 'puppeteer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeBrowserSafely } from './close-browser-safely.js';

// Compile-time assertion: the real Puppeteer `Browser` type must remain
// assignable to {@link ClosableBrowser}. If puppeteer ever narrows
// `Browser.process()` or removes `close()`, this line fails to type-check
// instead of silently breaking the production cleanup path.
type _BrowserAssignableToClosable = Browser extends ClosableBrowser ? true : never;
// Reference the alias so unused-type lints stay quiet.
const _browserAssignableAssertion: _BrowserAssignableToClosable = true;
void _browserAssignableAssertion;

/**
 * Builds a minimal {@link ClosableBrowser} stub for testing.
 * @param close - Implementation of `close()`.
 * @param childProcess - Value returned by `process()`.
 * @returns A stub browser.
 */
function createBrowserStub(
	close: () => Promise<void>,
	childProcess: ReturnType<ClosableBrowser['process']> = null,
): ClosableBrowser {
	return {
		close,
		process: () => childProcess,
	};
}

describe('closeBrowserSafely', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns false and does not kill when close resolves quickly', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const browser = createBrowserStub(async () => {}, { kill, killed: false });

		const promise = closeBrowserSafely(browser, 30_000);
		await vi.advanceTimersByTimeAsync(0);
		const timedOut = await promise;

		expect(timedOut).toBe(false);
		expect(kill).not.toHaveBeenCalled();
		// The losing timer must be cleared so it never keeps the event loop alive.
		expect(vi.getTimerCount()).toBe(0);
	});

	it('returns true and SIGKILLs the process when close hangs past the timeout', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		// A close() that never settles, simulating a wedged Chromium connection.
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			kill,
			killed: false,
		});

		const promise = closeBrowserSafely(browser, 30_000);
		await vi.advanceTimersByTimeAsync(30_000);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('returns false and does not kill when close rejects', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const browser = createBrowserStub(
			() => Promise.reject(new Error('Connection closed')),
			{ kill, killed: false },
		);

		const promise = closeBrowserSafely(browser, 30_000);
		await vi.advanceTimersByTimeAsync(0);
		const timedOut = await promise;

		expect(timedOut).toBe(false);
		expect(kill).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('returns true without throwing when the timed-out browser has no child process', async () => {
		vi.useFakeTimers();
		const browser = createBrowserStub(() => new Promise<void>(() => {}), null);

		const promise = closeBrowserSafely(browser, 30_000);
		await vi.advanceTimersByTimeAsync(30_000);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not re-kill a process that is already dead on timeout', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			kill,
			killed: true,
		});

		const promise = closeBrowserSafely(browser, 30_000);
		await vi.advanceTimersByTimeAsync(30_000);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		expect(kill).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('defaults to a 30-second timeout when none is provided', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			kill,
			killed: false,
		});

		const promise = closeBrowserSafely(browser);
		// Just shy of 30s: still pending, not yet killed.
		await vi.advanceTimersByTimeAsync(29_999);
		expect(kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
	});

	it('swallows a close() rejection that arrives after the race has timed out', async () => {
		vi.useFakeTimers();
		let rejectClose: (error: Error) => void = () => {};
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const browser = createBrowserStub(
			() =>
				new Promise<void>((_, reject) => {
					rejectClose = reject;
				}),
			{ kill, killed: false },
		);

		const unhandled = vi.fn<(reason: unknown) => void>();
		process.on('unhandledRejection', unhandled);
		try {
			const promise = closeBrowserSafely(browser, 30_000);
			await vi.advanceTimersByTimeAsync(30_000);
			const timedOut = await promise;
			expect(timedOut).toBe(true);

			// close() finally settles AFTER the race already resolved — the
			// realistic post-SIGKILL scenario where Puppeteer detects a broken
			// CDP connection.
			rejectClose(new Error('Connection terminated'));
			// Flush microtasks so the rejection has a chance to escape.
			await vi.advanceTimersByTimeAsync(0);
			await Promise.resolve();

			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off('unhandledRejection', unhandled);
		}
	});

	it('treats timeoutMs = 0 as an immediate SIGKILL', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			kill,
			killed: false,
		});

		const promise = closeBrowserSafely(browser, 0);
		await vi.advanceTimersByTimeAsync(0);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
	});

	it('still resolves and SIGKILLs even when kill() returns false (ESRCH)', async () => {
		vi.useFakeTimers();
		// `kill()` returns false when the process has already exited (ESRCH).
		// closeBrowserSafely must not depend on the return value to make
		// progress — its contract is "best-effort terminate, always resolve".
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => false);
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			kill,
			killed: false,
		});

		const promise = closeBrowserSafely(browser, 30_000);
		await vi.advanceTimersByTimeAsync(30_000);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
	});

	it('is idempotent: a second call after a successful close is a no-op', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		// After the first close() succeeds, puppeteer's real process() would
		// return null. Model that by flipping the stub's return on each call.
		let processCallCount = 0;
		const browser: ClosableBrowser = {
			close: async () => {},
			process: () => {
				processCallCount += 1;
				return processCallCount === 1 ? { kill, killed: false } : null;
			},
		};

		const first = await closeBrowserSafely(browser, 30_000);
		const second = await closeBrowserSafely(browser, 30_000);
		await vi.advanceTimersByTimeAsync(0);

		expect(first).toBe(false);
		expect(second).toBe(false);
		expect(kill).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('tree-kills the Chromium process tree on timeout when pid is available', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const killTree = vi.fn<
			(pid: number, signal: NodeJS.Signals | number) => Promise<void>
		>(async () => {});
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			pid: 12_345,
			kill,
			killed: false,
		});

		const promise = closeBrowserSafely(browser, 30_000, { killTree });
		await vi.advanceTimersByTimeAsync(30_000);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		// The parent is SIGKILL'd via Node's ChildProcess.kill so Node reaps it
		// correctly, and the whole tree is also walked via killProcessTree.
		expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
		expect(killTree).toHaveBeenCalledExactlyOnceWith(12_345, 'SIGKILL');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('skips tree-kill when the child process has no pid (connected, not launched)', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const killTree = vi.fn<
			(pid: number, signal: NodeJS.Signals | number) => Promise<void>
		>(async () => {});
		// `pid` may be undefined immediately after spawn or when puppeteer.connect()
		// was used instead of launch(). The OS-level tree-kill needs a PID, so we
		// fall back to the single-process SIGKILL only.
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			kill,
			killed: false,
		});

		const promise = closeBrowserSafely(browser, 30_000, { killTree });
		await vi.advanceTimersByTimeAsync(30_000);
		const timedOut = await promise;

		expect(timedOut).toBe(true);
		expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
		expect(killTree).not.toHaveBeenCalled();
	});

	it('does not tree-kill when close completes within the timeout', async () => {
		vi.useFakeTimers();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const killTree = vi.fn<
			(pid: number, signal: NodeJS.Signals | number) => Promise<void>
		>(async () => {});
		const browser = createBrowserStub(async () => {}, {
			pid: 12_345,
			kill,
			killed: false,
		});

		const promise = closeBrowserSafely(browser, 30_000, { killTree });
		await vi.advanceTimersByTimeAsync(0);
		const timedOut = await promise;

		expect(timedOut).toBe(false);
		expect(kill).not.toHaveBeenCalled();
		expect(killTree).not.toHaveBeenCalled();
	});
});
