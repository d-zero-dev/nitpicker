import c from 'ansi-colors';

/**
 * Parameters for formatting crawl progress display.
 */
interface FormatCrawlProgressParams {
	/** Number of URLs completed by the deal queue */
	readonly done: number;
	/** Total number of URLs in the deal queue (including completed) */
	readonly total: number;
	/** Offset from a previous resumed session */
	readonly resumeOffset: number;
	/** Number of external URLs discovered */
	readonly externalTotal: number;
	/** Number of external URLs completed */
	readonly externalDone: number;
	/** Number of parallel workers */
	readonly limit: number;
}

/**
 * Formats the crawl progress header for the deal() progress display.
 *
 * Shows "done / found (remaining)" format instead of "done/total"
 * to make it clearer that the total is expected to grow during crawling.
 * @param params - The crawl progress parameters.
 * @param params.done - Number of URLs completed by the deal queue.
 * @param params.total - Total number of URLs in the deal queue (including completed).
 * @param params.resumeOffset - Offset from a previous resumed session.
 * @param params.externalTotal - Number of external URLs discovered.
 * @param params.externalDone - Number of external URLs completed.
 * @param params.limit - Number of parallel workers.
 * @returns The formatted progress string with ANSI color codes.
 */
export function formatCrawlProgress({
	done,
	total,
	resumeOffset,
	externalTotal,
	externalDone,
	limit,
}: FormatCrawlProgressParams): string {
	const allDone = done + resumeOffset;
	const allTotal = total + resumeOffset;
	const internalDone = allDone - externalDone;
	const internalTotal = allTotal - externalTotal;
	const internalRemaining = internalTotal - internalDone;
	const externalRemaining = externalTotal - externalDone;
	const totalRemaining = internalRemaining + externalRemaining;
	const pct = allTotal > 0 ? Math.round((allDone / allTotal) * 100) : 0;

	return (
		c.bold(`Crawling: ${internalDone} done / ${internalTotal} found`) +
		c.dim(` (+${externalDone}/${externalTotal} ext)`) +
		c.bold(` (${pct}%) [${totalRemaining} remaining]`) +
		c.dim(` [${limit} parallel]`)
	);
}
