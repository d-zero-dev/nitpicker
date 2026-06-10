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
		/** Sends a signal to the process; returns whether it was delivered. */
		kill(signal?: NodeJS.Signals | number): boolean;
		/** Whether a signal has already been successfully sent to the process. */
		readonly killed: boolean;
	} | null;
}

/**
 * Closes a Puppeteer browser, falling back to a hard `SIGKILL` if the graceful
 * close hangs.
 *
 * WHY: When a page's Chromium session dies mid-scrape (e.g. a viewport change
 * detaches the frame, surfacing `Attempted to use detached Frame` or
 * `Session closed`), the CDP connection can be left wedged. A bare
 * `await browser.close()` then never settles, stalling the `deal()` worker and
 * hanging the whole crawl. Racing the close against a timeout and SIGKILLing the
 * orphaned Chromium process on expiry guarantees the worker always completes.
 *
 * The losing timer is cleared explicitly in `.finally()` so it never keeps the
 * event loop alive after the race settles (a plain `delay()` in `Promise.race`
 * would leak the timer until it fires).
 *
 * Limitation: SIGKILL is sent only to the Chromium parent process, not to its
 * renderer/network/zygote children. Puppeteer spawns Chromium with
 * `detached: false`, so we cannot kill the whole process group (a negative-PID
 * signal would also hit our own Node process). The orphaned children detect
 * their broken IPC pipe and self-exit, typically within sub-seconds, so this
 * is a brief leak rather than a permanent one — but it is intrinsic to the
 * single-process kill strategy.
 * @param browser - The browser to close.
 * @param timeoutMs - Milliseconds to wait for a graceful close before force-killing.
 *   Defaults to {@link DEFAULT_CLOSE_TIMEOUT_MS}.
 * @returns `true` if the graceful close timed out (and a SIGKILL was attempted),
 *   `false` if `close()` settled in time.
 */
export async function closeBrowserSafely(
	browser: ClosableBrowser,
	timeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
): Promise<boolean> {
	// Capture the process up-front: after a successful close() puppeteer
	// releases its internal reference and process() returns null, so we would
	// have no handle to SIGKILL on timeout.
	const childProcess = browser.process();

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timedOut = await Promise.race([
		browser
			.close()
			.then(() => false)
			.catch(() => false),
		new Promise<boolean>((resolve) => {
			timeoutHandle = setTimeout(() => resolve(true), timeoutMs);
		}),
	]).finally(() => {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	});

	if (timedOut && childProcess && !childProcess.killed) {
		childProcess.kill('SIGKILL');
	}

	return timedOut;
}
