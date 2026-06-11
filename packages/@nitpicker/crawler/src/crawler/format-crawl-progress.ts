import c from 'ansi-colors';

/**
 * Number formatter for thousands-separated count display (e.g. `1,234,567`).
 */
const countFormat = new Intl.NumberFormat('en-US');

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
	/**
	 * Number of HTML pages actually rendered by the browser in the current session.
	 * Excludes HEAD-only resources, title-only metadata fetches, and skipped URLs.
	 */
	readonly pagesScraped: number;
	/** Number of parallel workers */
	readonly limit: number;
}

/**
 * Formats the crawl progress header for the deal() progress display.
 *
 * Shows "done(pages) / found URLs (remaining)" format instead of "done/total"
 * to make it clearer that the total is expected to grow during crawling,
 * that the counts are processed URLs (not resulting pages), and how many of
 * those URLs were actually rendered by the browser as HTML pages.
 * Counts are formatted with thousands separators (e.g. `1,234,567`).
 * @param params - The crawl progress parameters.
 * @param params.done - Number of URLs completed by the deal queue.
 * @param params.total - Total number of URLs in the deal queue (including completed).
 * @param params.resumeOffset - Offset from a previous resumed session.
 * @param params.externalTotal - Number of external URLs discovered.
 * @param params.externalDone - Number of external URLs completed.
 * @param params.pagesScraped - Number of HTML pages rendered by the browser in this session.
 * @param params.limit - Number of parallel workers.
 * @returns The formatted progress string with ANSI color codes.
 */
export function formatCrawlProgress({
	done,
	total,
	resumeOffset,
	externalTotal,
	externalDone,
	pagesScraped,
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
		c.bold(
			`Crawling: ${countFormat.format(internalDone)}(${countFormat.format(pagesScraped)}) done / ${countFormat.format(internalTotal)} found URLs`,
		) +
		c.dim(
			` (+${countFormat.format(externalDone)}/${countFormat.format(externalTotal)} ext)`,
		) +
		c.bold(` (${pct}%) [${countFormat.format(totalRemaining)} remaining]`) +
		c.dim(` [${limit} parallel]`)
	);
}
