import type { BufferedPhaseError } from './drain-phase-errors.js';
import type { ChangePhaseEvent } from '@d-zero/beholder';

/**
 * Options for {@link createChangePhaseHandler}. Declared structurally so
 * tests can pass plain `vi.fn()` stubs without spinning up a real Crawler.
 */
export interface ChangePhaseHandlerOptions {
	/**
	 * Forwards the raw {@link ChangePhaseEvent} so external listeners on the
	 * Crawler still see every transition (typically `this.emit.bind(this)`
	 * narrowed to the `changePhase` channel).
	 */
	emit: (event: ChangePhaseEvent) => void;
	/** Receives the formatted progress log line. Skipped when empty. */
	update: (log: string) => void;
	/**
	 * Renders the human-readable progress message for an event. Injected so
	 * the handler stays free of the Crawler's internal log formatter.
	 * Returns `null` for events that should not surface to `update`.
	 */
	formatLog: (event: ChangePhaseEvent) => string | null;
	/**
	 * Per-URL buffer of `retryExhausted` failures. The handler appends to
	 * this map; it does not drain (that is `drainPhaseErrors`'s job).
	 */
	buffer: Map<string, BufferedPhaseError[]>;
	/** URL href used as the buffer key for this scrape. */
	urlHref: string;
}

/**
 * Builds the `scraper.on('changePhase', ...)` listener used by
 * {@link Crawler.#launchBrowserAndScrape}.
 *
 * Three responsibilities:
 * 1. Render the phase log via the injected `formatLog` and pipe it to `update`.
 * 2. Forward the raw event so external consumers (CLI progress UI etc.) see
 *    every transition.
 * 3. Buffer `retryExhausted` events into the per-URL phase-error map so they
 *    can be drained as `pageError` events AFTER the `page` event fires.
 *
 * WHY a factory: the listener captures per-scrape state (`buffer`, `urlHref`,
 * `update`). Extracting the factory makes the wiring directly unit-testable
 * with plain stubs, instead of requiring a mocked Puppeteer + beholder + dealer
 * stack to drive the worker.
 *
 * **Caller contract**: register the returned handler at most once per
 * `scraper` instance. The Crawler creates a fresh Scraper per URL so this
 * holds today; if scraper pooling is ever introduced, register exactly one
 * handler per scrape and unregister it on completion to avoid duplicate
 * buffer entries.
 * @param options - Wiring dependencies for the handler.
 * @returns A function suitable for `scraper.on('changePhase', ...)`.
 */
export function createChangePhaseHandler(
	options: ChangePhaseHandlerOptions,
): (event: ChangePhaseEvent) => void {
	const { emit, update, formatLog, buffer, urlHref } = options;
	return (event) => {
		const msg = formatLog(event);
		if (msg) {
			update(msg);
		}
		emit(event);

		// retryExhausted fires when beholder's @retryable gives up on a
		// secondary scrape step (e.g. a viewport switch detaching the frame
		// in #fetchImages). The page itself still completes, so we buffer
		// the failure here and emit it as a pageError after the page event
		// has been emitted.
		if (event.name === 'retryExhausted') {
			const list = buffer.get(urlHref) ?? [];
			list.push({ phase: event.name, message: event.message });
			buffer.set(urlHref, list);
		}
	};
}
