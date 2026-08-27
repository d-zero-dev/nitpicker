/** Parameters accepted by the static HTML reporter. */
export interface HtmlReportParams {
	/** Path to a completed `.nitpicker` archive. */
	readonly filePath: string;
	/** Destination path, or omitted for `<archive-name>.html` in the current directory. */
	readonly outputPath?: string;
	/** Comma-separated directory prefixes used for non-interactive large reports. */
	readonly directoryInput?: string;
	/** Whether the reporter may prompt for directory prefixes. */
	readonly interactive?: boolean;
	/** Suppresses completion and warning output. */
	readonly silent?: boolean;
	/** Receives archive extraction byte progress. */
	readonly onExtractProgress?: (readBytes: number, totalBytes: number) => void;
}

/** Normalized directory prefix used to constrain inner-page rows. */
export interface HtmlReportDirectoryPrefix {
	/** Exact URL origin for full-URL input, or `null` for pathname-only input. */
	readonly origin: string | null;
	/** Normalized absolute pathname without a trailing slash, except `/`. */
	readonly pathname: string;
	/** User-facing normalized representation passed to query directory filters. */
	readonly display: string;
}
