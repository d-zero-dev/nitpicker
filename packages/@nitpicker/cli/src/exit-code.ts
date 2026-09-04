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
	/**
	 * The crawl ended without finishing — pages remain pending and
	 * `--max-auto-retry` was exhausted (or made no progress), or auto-retry
	 * was disabled outright (issue #350). This is an expected, recoverable
	 * outcome (`crawl <stub> --resume` / `--retry-failed`), not a crash —
	 * distinct from `Fatal` so a caller (CI, an orchestration script) can
	 * tell "try again later" apart from "something is broken."
	 */
	Incomplete: 3,
} as const;
