import { formatProgressCount } from './format-progress-count.js';

/**
 * Builds a count-progress callback that renders `<label>: N/M <unit> (x%)`
 * lines, deduplicated on the rendered message — chunked DB operations
 * (`setUrlOrder`, `repromoteExternalPages`, `resetFailedPages`,
 * `getResourceUrlList`) report progress once per chunk, and a large archive
 * can still produce enough chunks to spam a non-verbose overwrite line if
 * two consecutive chunks happen to render the same percentage (issue #294).
 *
 * Takes a `logLine` sink rather than a `Lanes` instance directly, mirroring
 * {@link createByteProgressLogger}: display concerns (which lane,
 * `--verbose` timestamp-prefixing) stay in the caller's own `logLine`
 * helper.
 * @param logLine - Called with the rendered message whenever it changes.
 * @param label - The line's label, e.g. `"Sorting pages"`.
 * @param unit - Plural unit noun to display. Defaults to `"pages"`.
 * @returns A `(processed, total)` callback.
 * @example
 * ```ts
 * orchestrator.on('sortingUrls', ({ processed, total }) => {
 *   sortingUrlsLogger(processed, total);
 * });
 * ```
 */
export function createCountProgressLogger(
	logLine: (message: string) => void,
	label: string,
	unit = 'pages',
): (processed: number, total: number) => void {
	let lastMessage = '';
	return (processed, total) => {
		const message = `%braille% ${label}: ${formatProgressCount(processed, total, unit)}`;
		if (message === lastMessage) {
			return;
		}
		lastMessage = message;
		logLine(message);
	};
}
