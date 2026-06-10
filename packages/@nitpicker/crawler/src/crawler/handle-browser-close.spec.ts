import type { ClosableBrowser } from './close-browser-safely.js';
import type { BrowserCloseLogger } from './handle-browser-close.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleBrowserClose } from './handle-browser-close.js';

/**
 * Builds a minimal {@link ClosableBrowser} stub.
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

describe('handleBrowserClose', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('logs nothing when the browser closes gracefully', async () => {
		const log = vi.fn<BrowserCloseLogger>();
		const browser = createBrowserStub(async () => {});

		await handleBrowserClose(browser, 'https://example.com/page', log);

		expect(log).not.toHaveBeenCalled();
	});

	it('logs a force-kill notice with the URL when close() times out', async () => {
		vi.useFakeTimers();
		const log = vi.fn<BrowserCloseLogger>();
		const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
		const browser = createBrowserStub(() => new Promise<void>(() => {}), {
			kill,
			killed: false,
		});

		const promise = handleBrowserClose(browser, 'https://example.com/slow', log);
		await vi.advanceTimersByTimeAsync(30_000);
		await promise;

		expect(log).toHaveBeenCalledExactlyOnceWith(
			'Force-killed wedged Chromium browser for %s (close() timed out)',
			'https://example.com/slow',
		);
		expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
	});

	it('logs the error with the URL when closeBrowserSafely itself throws', async () => {
		const log = vi.fn<BrowserCloseLogger>();
		// `process()` throwing is the realistic way `closeBrowserSafely` can
		// reject: it runs inside the async function, so an unexpected throw
		// there surfaces as a rejection from the awaited call.
		const browser: ClosableBrowser = {
			close: () => Promise.resolve(),
			process: () => {
				throw new TypeError('process() blew up');
			},
		};

		await handleBrowserClose(browser, 'https://example.com/boom', log);

		expect(log).toHaveBeenCalledExactlyOnceWith(
			'closeBrowserSafely failed for %s: %O',
			'https://example.com/boom',
			expect.any(TypeError),
		);
	});

	it('never rejects, even when both close() and process() misbehave', async () => {
		const log = vi.fn<BrowserCloseLogger>();
		const browser: ClosableBrowser = {
			close: () => Promise.reject(new Error('close exploded')),
			process: () => {
				throw new Error('process exploded');
			},
		};

		// The point of this function is to guarantee finally-safety: the
		// returned promise must always resolve, never reject, so that
		// `finally { await handleBrowserClose(...) }` cannot mask the
		// try-block's outcome.
		await expect(
			handleBrowserClose(browser, 'https://example.com', log),
		).resolves.toBeUndefined();
	});
});
