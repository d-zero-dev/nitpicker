/** Parameters accepted by the static HTML reporter. */
export interface HtmlReportParams {
	/** Path to a completed `.nitpicker` archive. */
	readonly filePath: string;
	/** Destination path, or omitted for `<archive-name>.html` in the current directory. */
	readonly outputPath?: string;
	/** Comma-separated directory prefixes used for non-interactive large reports. */
	readonly directoryInput?: string;
	/**
	 * URL allowlist restricting the report to exactly these pages, already
	 * classified into valid/invalid by the CLI (`readUrlListFile` +
	 * `isValidUrl`) but not yet normalized to the archive's own URL form —
	 * `report()` does that via `resolveAndValidatePageListUrlFilter` once the
	 * archive is open. ANDed with `directoryInput` when both are given. Skips the
	 * interactive/10,000-page-limit-prompting flow `directoryInput` alone
	 * triggers — see `resolvePageSelection`.
	 */
	readonly urls?: readonly string[];
	/** Whether the reporter may prompt for directory prefixes. */
	readonly interactive?: boolean;
	/** Suppresses completion and warning output. */
	readonly silent?: boolean;
	/** Receives archive extraction byte progress. */
	readonly onExtractProgress?: (readBytes: number, totalBytes: number) => void;
}

/** Normalized directory prefix used to constrain inner-page rows. */
export interface HtmlReportDirectoryPrefix {
	/**
	 * Reconstructed `https://{hostname}` for a full-URL input (scheme and
	 * port dropped, matching `parsePageDirectoryPrefix`), or `null` for
	 * pathname-only input.
	 */
	readonly origin: string | null;
	/**
	 * Normalized absolute pathname without a trailing slash. The site root
	 * is `/` here so the CLI can show it; query matching treats `/` as no
	 * path restriction.
	 */
	readonly pathname: string;
	/** User-facing normalized representation passed to query directory filters. */
	readonly display: string;
}
