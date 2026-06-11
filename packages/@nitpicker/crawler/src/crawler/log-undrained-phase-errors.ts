import type { BufferedPhaseError } from './drain-phase-errors.js';

/**
 * Debug logger compatible with the `debug` package's printf-style API.
 *
 * Receives a single line per URL whose buffered phase errors were
 * undrained at finally time.
 */
export type PhaseErrorDropLogger = (
	/** printf-style format string. */
	formatter: string,
	/** Arguments interpolated into the format string. */
	...args: readonly unknown[]
) => void;

/**
 * Logs and clears any phase errors still buffered for `urlHref` at
 * worker-finally time.
 *
 * WHY: a Crawler worker's finally clause runs for every code path —
 * success, hard error, and the early `return` taken for predicted URLs
 * that were discarded after probing. The success and catch branches
 * drain via `drainPhaseErrors`, but the predicted-discard branch
 * skips drain entirely, so any `retryExhausted` events captured during
 * its probe would silently leak from the Map.
 *
 * Calling this function as the final cleanup step:
 * - Surfaces the drop via `DEBUG=Nitpicker:Crawler` so production runs
 *   are observable instead of silent.
 * - Removes the buffer entry so it does not grow across crawls.
 *
 * Safe to call after a successful drain: the buffer entry is already
 * gone and both the log and the delete become no-ops.
 * @param buffer - The pending-phase-errors map, keyed by URL href.
 * @param urlHref - URL whose buffer entry should be flushed.
 * @param log - Receives one line if any undrained errors are present.
 * @returns The number of phase-error records dropped (0 when nothing
 *   was buffered).
 */
export function logUndrainedPhaseErrors(
	buffer: Map<string, BufferedPhaseError[]>,
	urlHref: string,
	log: PhaseErrorDropLogger,
): number {
	const remaining = buffer.get(urlHref);
	if (!remaining || remaining.length === 0) {
		buffer.delete(urlHref);
		return 0;
	}
	log(
		'Dropped %d phase error(s) for %s (no archive entry created)',
		remaining.length,
		urlHref,
	);
	buffer.delete(urlHref);
	return remaining.length;
}
