/**
 * Emits a human-readable progress line for a long-running populate step.
 * Injected the same way as `PageDomPathResolver`
 * (`populate-entity-tables/populate-image-items.ts`) — the crawler
 * package stays silent by default for library consumers, while
 * `scripts/migrate-to-0.13.mjs` supplies a `console.log`-backed callback.
 */
export type ProgressCallback = (message: string) => void;

/** Progress tiers per run — one report per 5% of `total`, so a 13M-row table produces ~20 lines, not one per chunk. */
const TIERS = 20;

/**
 * Returns a `report(processed)` function that calls `onProgress` at most
 * once per 5%-of-`total` tier crossed, so a keyset-paginated loop over a
 * multi-million-row table can report progress every chunk without
 * flooding the log with one line per chunk.
 * @param label - Prefix identifying which populate step / source table
 *   this reporter tracks, e.g. `"url_refs (resources)"`.
 * @param total - Total row/page count the loop will scan, precomputed by
 *   the caller via a `COUNT(*)`.
 * @param onProgress - Caller-supplied sink, or `undefined` to disable
 *   reporting entirely (zero overhead — `report` becomes a no-op).
 * @returns `report(processed)` — call after each chunk with the
 *   cumulative count processed so far.
 * @example
 * const total = Number((await trx('url_refs').count({ n: '*' }))[0]?.n ?? 0);
 * const report = createProgressReporter('url_refs', total, onProgress);
 * let processed = 0;
 * // ...inside the read-chunk loop...
 * processed += rows.length;
 * report(processed);
 */
export function createProgressReporter(
	label: string,
	total: number,
	onProgress: ProgressCallback | undefined,
): (processed: number) => void {
	let lastTier = 0;
	return (processed: number): void => {
		if (onProgress === undefined || total === 0) {
			return;
		}
		const tier = Math.floor((processed / total) * TIERS);
		if (tier <= lastTier) {
			return;
		}
		lastTier = tier;
		const percent = Math.min(100, Math.round((processed / total) * 100));
		onProgress(`${label}: ${processed}/${total} (${percent}%)`);
	};
}
