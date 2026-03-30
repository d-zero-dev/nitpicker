import type { CrawlerError } from '@nitpicker/crawler';

/**
 * Type guard that checks whether a collected error is a {@link CrawlerError}
 * originating from an external URL.
 *
 * `CrawlerError` objects carry both `pid` and `isExternal` fields set by the crawler.
 * Plain `Error` objects (e.g. from event handler rejections) are treated
 * as internal errors.
 * @param error - The error to check
 * @returns `true` if the error is a `CrawlerError` with `isExternal` set to `true`.
 */
function isCrawlerExternalError(error: CrawlerError | Error): boolean {
	return 'pid' in error && 'isExternal' in error && error.isExternal === true;
}

/**
 * Error thrown when one or more errors occurred during crawling.
 * Wraps the collected errors so callers can inspect them.
 */
export class CrawlAggregateError extends Error {
	/** The individual errors that occurred during crawling. */
	readonly errors: readonly (CrawlerError | Error)[];

	/** Whether all errors are from external (out-of-scope) URLs only. */
	readonly hasOnlyExternalErrors: boolean;

	/**
	 * @param errors - The individual errors collected during the crawl session.
	 */
	constructor(errors: (CrawlerError | Error)[]) {
		const externalCount = errors.filter(isCrawlerExternalError).length;
		const internalCount = errors.length - externalCount;
		const hasOnlyExternal = errors.length > 0 && internalCount === 0;

		const parts: string[] = [];
		if (internalCount > 0) {
			parts.push(`${internalCount} internal`);
		}
		if (externalCount > 0) {
			parts.push(`${externalCount} external`);
		}
		const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : '';
		super(`Crawl completed with ${errors.length} error(s)${breakdown}.`);

		this.errors = errors;
		this.hasOnlyExternalErrors = hasOnlyExternal;
	}
}
