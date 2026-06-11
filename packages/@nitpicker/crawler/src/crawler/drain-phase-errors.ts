/**
 * A buffered phase-error record awaiting emission as a `pageError` event.
 *
 * `phase` is the beholder phase name (typically `'retryExhausted'`) and
 * `message` is the human-readable failure text.
 */
export interface BufferedPhaseError {
	/** Scrape phase name. */
	phase: string;
	/** Human-readable failure message. */
	message: string;
}

/**
 * Emitter signature accepted by {@link drainPhaseErrors} for the `pageError`
 * event. Declared structurally so the Crawler's typed event emitter can be
 * adapted with a thin closure at the call site without leaking through here.
 */
export type DrainPhaseErrorsEmit = (payload: {
	/** URL of the affected page. */
	url: string;
	/** Scrape phase name. */
	phase: string;
	/** Human-readable failure message. */
	message: string;
	/** Whether the URL is external to the crawl scope. */
	isExternal: boolean;
}) => void;

/**
 * Drains the buffered phase errors for a URL: removes the entry from
 * `buffer` and invokes `emit` once per buffered record.
 *
 * WHY a standalone function: the Crawler buffers `retryExhausted` events
 * keyed by `url.href` during scrapeStart, then flushes them as
 * `pageError` events AFTER `page` / `externalPage` has been emitted so the
 * orchestrator's WriteQueue serialises `setPage` before `insertPageError`.
 * Extracting the drain step here makes the flush + delete contract
 * directly unit-testable without spinning up a real Crawler.
 *
 * Idempotent: calling twice for the same `urlHref` is safe — the second
 * call sees an empty buffer and is a no-op.
 * @param buffer - The pending-phase-errors map, keyed by URL href.
 * @param urlHref - URL whose buffered errors should be drained.
 * @param isExternal - Whether the URL is external to the crawl scope.
 * @param emit - Callback invoked once per buffered phase-error record.
 * @returns The number of phase-error events emitted (0 when the buffer
 *   had no entry for `urlHref`).
 */
export function drainPhaseErrors(
	buffer: Map<string, BufferedPhaseError[]>,
	urlHref: string,
	isExternal: boolean,
	emit: DrainPhaseErrorsEmit,
): number {
	const errors = buffer.get(urlHref);
	if (!errors || errors.length === 0) return 0;
	buffer.delete(urlHref);
	for (const err of errors) {
		emit({
			url: urlHref,
			phase: err.phase,
			message: err.message,
			isExternal,
		});
	}
	return errors.length;
}
