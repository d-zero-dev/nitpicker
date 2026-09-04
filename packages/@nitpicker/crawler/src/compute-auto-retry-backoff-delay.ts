/** Initial wait before the first auto-retry attempt, in milliseconds. */
const INITIAL_DELAY_MS = 30_000;

/** Upper bound on the wait between auto-retry attempts, in milliseconds. */
const MAX_DELAY_MS = 300_000;

/**
 * Computes the exponential backoff delay before an auto-retry attempt
 * (issue #350): 30s, 60s, 120s, … doubling each attempt, capped at 5
 * minutes so a long run of retries against a persistently slow site does
 * not stall for arbitrarily long between attempts.
 *
 * WHY NOT `@d-zero/shared/retry`'s `retryCall`: that helper retries a
 * single async call until it stops throwing, driven entirely by
 * exceptions — this loop instead re-runs a whole crawl pass and decides
 * whether to continue by reading `getCrawlingState().pending` afterward
 * (no exception involved on the "still pending" path) and can abandon
 * early on a no-progress attempt, neither of which `retryCall`'s
 * catch-and-retry model expresses. `@d-zero/shared/retry` also does not
 * export its interval math as a standalone function (only the
 * `retryCall`/`retry` entry points, which own the whole wait+retry loop
 * internally), so there is nothing smaller to reuse for just the delay
 * calculation either.
 * @param attempt - The 1-indexed attempt number about to run.
 * @returns The delay in milliseconds to wait before that attempt.
 * @example
 * ```ts
 * computeAutoRetryBackoffDelayMs(1);
 * // => 30_000 (30s)
 * computeAutoRetryBackoffDelayMs(2);
 * // => 60_000 (60s)
 * computeAutoRetryBackoffDelayMs(10);
 * // => 300_000 (5min) — capped
 * ```
 */
export function computeAutoRetryBackoffDelayMs(attempt: number): number {
	return Math.min(INITIAL_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}
