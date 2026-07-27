import type {
	NetworkErrorRecord,
	NetworkOutageDetectorOptions,
	OutageSuspect,
} from './types.js';

import { NETWORK_RELATED_ERROR_KINDS } from '../network-related-error-kinds.js';

/**
 * Sliding-window detector for "this looks like the crawl operator's own
 * network, not the target sites, is having a bad time" — the trigger that
 * hands off to an active probe (see `probe-network.ts`) before the crawler
 * commits to pausing.
 *
 * Deliberately dependency-free: no timers, no DB, no `Crawler` instance.
 * Time flows in via {@link NetworkErrorRecord.at} only, which is what makes
 * window-boundary behaviour testable with exact values instead of
 * `vi.useFakeTimers()`.
 * @example
 * ```ts
 * const detector = new NetworkOutageDetector({
 *   windowMs: 10_000,
 *   errorThreshold: 5,
 *   hostThreshold: 2,
 * });
 * const suspect = detector.record({ kind: 'dns', host: 'a.example', at: Date.now() });
 * if (suspect) {
 *   // probe before closing the gate
 * }
 * ```
 */
export default class NetworkOutageDetector {
	#entries: { host: string; at: number }[] = [];
	readonly #errorThreshold: number;
	readonly #hostThreshold: number;
	readonly #windowMs: number;

	constructor(options: NetworkOutageDetectorOptions) {
		this.#windowMs = options.windowMs;
		this.#errorThreshold = options.errorThreshold;
		this.#hostThreshold = options.hostThreshold;
	}

	/**
	 * Record one observed error and check whether it tips the sliding window
	 * over both thresholds.
	 *
	 * Non-network `kind`s (see `NETWORK_RELATED_ERROR_KINDS`) are silently
	 * ignored: they never enter the window and can never contribute to a
	 * trigger, regardless of how many arrive.
	 * @param record - The observed error.
	 * @param record.kind
	 * @param record.host
	 * @param record.at
	 * @returns An {@link OutageSuspect} the instant both thresholds are met,
	 *   or `null` otherwise. On a trigger, the window is cleared so the same
	 *   batch of errors cannot fire a second time on the next call.
	 */
	record({ kind, host, at }: NetworkErrorRecord): OutageSuspect | null {
		if (!NETWORK_RELATED_ERROR_KINDS.has(kind)) {
			return null;
		}

		const cutoff = at - this.#windowMs;
		this.#entries = this.#entries.filter((entry) => entry.at >= cutoff);
		this.#entries.push({ host, at });

		const distinctHosts = new Set(this.#entries.map((entry) => entry.host)).size;
		if (
			this.#entries.length < this.#errorThreshold ||
			distinctHosts < this.#hostThreshold
		) {
			return null;
		}

		const startedAt = Math.min(...this.#entries.map((entry) => entry.at));
		const suspect: OutageSuspect = {
			startedAt,
			detectedAt: at,
			triggerErrorCount: this.#entries.length,
			triggerHostCount: distinctHosts,
		};
		this.#entries = [];
		return suspect;
	}

	/**
	 * Clear the sliding window. Called at the start of a fresh crawl session
	 * (`Crawler.#runDeal`) so error observations from a prior session on the
	 * same `Crawler` instance never carry over — mirrors `#successfulHosts
	 * .clear()` / `#scrapedDestinations.clear()`'s per-session reset.
	 */
	reset(): void {
		this.#entries = [];
	}
}
