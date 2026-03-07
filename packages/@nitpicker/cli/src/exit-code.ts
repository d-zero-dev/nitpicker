/**
 * CLI exit codes for distinguishing between success, fatal errors, and partial success.
 */
export const ExitCode = {
	/** All operations completed successfully with no errors. */
	Success: 0,
	/** A fatal error occurred (e.g. missing arguments, internal errors, crawl failure). */
	Fatal: 1,
	/** Operations completed but with non-fatal warnings (e.g. external link errors only). */
	Warning: 2,
} as const;
