/**
 * Waits `ms` milliseconds, or returns immediately if `signal` aborts first
 * (issue #350's auto-retry backoff — up to 5 minutes, which a library
 * consumer calling `CrawlerOrchestrator#abort()` must be able to cut short
 * immediately rather than waiting out).
 *
 * WHY NOT `Promise.race([delay(ms), abortPromise])`: `@d-zero/shared`'s
 * `delay()` takes no `AbortSignal` and cannot cancel its own internal
 * `setTimeout` — racing it leaves that timer running (and its executor
 * closure alive) for the full `ms` even after the abort side already won,
 * which is exactly the "loser-side timer never cleared" pattern
 * ARCHITECTURE.md's invariants call out (`raceWithTimeout`'s own docs).
 * This instead owns a single `setTimeout` directly and clears it — via the
 * abort listener when the signal fires first, or by letting it fire
 * naturally and detaching the listener — on whichever path resolves.
 * @param ms - Milliseconds to wait.
 * @param signal - Aborting this resolves the returned promise immediately.
 * @returns A promise that resolves after `ms`, or immediately if already aborted.
 */
export function delayOrAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
}
