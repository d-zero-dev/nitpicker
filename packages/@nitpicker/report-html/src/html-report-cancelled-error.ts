/**
 * Thrown when the interactive directory prompt is dismissed (Ctrl+C), so
 * `report()` can unwind `await using` archive disposal instead of calling
 * `process.exit` from inside the library.
 *
 * `report-google-sheets` still exits immediately to dodge an enquirer
 * readline double-close; HTML reporting prefers a clean archive close, and
 * the CLI maps this error to exit code 0.
 * @example
 * ```ts
 * throw new HtmlReportCancelledError();
 * ```
 */
export class HtmlReportCancelledError extends Error {
	constructor() {
		super('HTML report cancelled');
		this.name = 'HtmlReportCancelledError';
	}
}
