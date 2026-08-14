import { raceWithTimeout } from '@d-zero/shared/race-with-timeout';

import { crawlerLog } from '../debug.js';

import { killProcessTree } from './kill-process-tree.js';

/**
 * Default time to wait for a graceful `browser.close()` before force-killing
 * the underlying Chromium process, in milliseconds.
 */
const DEFAULT_CLOSE_TIMEOUT_MS = 30 * 1000;

/**
 * Minimal structural subset of a Puppeteer `Browser` required to close it safely.
 *
 * Declared structurally (rather than importing Puppeteer's `Browser`) so the
 * function stays unit-testable with a lightweight stub and free of a Puppeteer
 * import.
 */
export interface ClosableBrowser {
	/** Gracefully closes the browser and all of its pages over the CDP connection. */
	close(): Promise<void>;
	/**
	 * Returns the underlying Chromium child process, or `null` when the browser
	 * was connected to (rather than launched) and therefore owns no process.
	 */
	process(): {
		/** PID of the Chromium parent process, or `undefined` before spawn settles. */
		readonly pid?: number;
		/** Sends a signal to the process; returns whether it was delivered. */
		kill(signal?: NodeJS.Signals | number): boolean;
		/** Whether a signal has already been successfully sent to the process. */
		readonly killed: boolean;
	} | null;
}

/**
 * Dependency overrides for {@link closeBrowserSafely}. Used only by tests
 * to substitute the tree-kill orchestration.
 */
export interface CloseBrowserSafelyDeps {
	/**
	 * Kills a process and every descendant. Defaults to {@link killProcessTree}.
	 */
	killTree?: (pid: number, signal: NodeJS.Signals | number) => Promise<void>;
}

/**
 * Closes a Puppeteer browser, falling back to a hard tree-kill if the graceful
 * close hangs.
 *
 * WHY: When a page's Chromium session dies mid-scrape (e.g. a viewport change
 * detaches the frame, surfacing `Attempted to use detached Frame` or
 * `Session closed`), the CDP connection can be left wedged. A bare
 * `await browser.close()` then never settles, stalling the `deal()` worker and
 * hanging the whole crawl. Racing the close against a timeout and SIGKILLing
 * the Chromium process tree (parent + renderer/network/zygote children) on
 * expiry guarantees the worker always completes and no orphan subprocesses are
 * left behind.
 *
 * Timer cleanup is delegated to `raceWithTimeout` (`@d-zero/shared`), which
 * clears the losing timer internally so it never keeps the event loop alive
 * after the race settles.
 *
 * The tree-kill happens via {@link killProcessTree}, which enumerates
 * descendants through `ps` (POSIX) or delegates to `taskkill /T /F` (Windows).
 * `childProcess.kill('SIGKILL')` is still invoked on the parent up-front
 * because Node's `ChildProcess.killed` flag governs how Node treats the
 * spawn handle (reaping etc.); without it the parent would linger in Node's
 * process table even after the OS-level kill.
 * @param browser - The browser to close.
 * @param timeoutMs - Milliseconds to wait for a graceful close before force-killing.
 *   Defaults to {@link DEFAULT_CLOSE_TIMEOUT_MS}.
 * @param deps - Test-time overrides (default-free for production callers).
 * @returns `true` if the graceful close timed out (and a tree-kill was
 *   attempted), `false` if `close()` settled in time.
 */
export async function closeBrowserSafely(
	browser: ClosableBrowser,
	timeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
	deps: CloseBrowserSafelyDeps = {},
): Promise<boolean> {
	// Capture the process up-front: after a successful close() puppeteer
	// releases its internal reference and process() returns null, so we would
	// have no handle to tree-kill on timeout.
	const childProcess = browser.process();

	const { timeout: timedOut } = await raceWithTimeout(
		() =>
			browser
				.close()
				.then(() => {})
				.catch(() => {}),
		timeoutMs,
	);

	if (timedOut && childProcess && !childProcess.killed) {
		// Mark the Node ChildProcess as killed so Node's reaping logic treats
		// it correctly; then walk the OS process tree.
		childProcess.kill('SIGKILL');
		// Capture pid once: ChildProcess.pid is technically `number | undefined`
		// (undefined before spawn settles), and reading it twice across the
		// `await` below would force the second read to re-widen back to
		// `number | undefined` regardless of the typeof guard. Snapshotting
		// makes the type and the runtime value match.
		const pid = childProcess.pid;
		if (typeof pid === 'number') {
			const killTree =
				deps.killTree ?? ((p, sig) => killProcessTree(p, sig, { log: crawlerLog }));
			await killTree(pid, 'SIGKILL');
		}
	}

	return timedOut;
}
