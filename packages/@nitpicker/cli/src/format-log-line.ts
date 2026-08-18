/**
 * Prefixes `message` with an ISO 8601 timestamp when `verbose` is true.
 *
 * Shared by every `Lanes`-based progress reporter in this package (issue
 * #294): a non-verbose `Lanes` line is overwritten in place and has no
 * history to time-correlate against, so it stays bare; a `--verbose` run's
 * lines are appended instead, so timestamping each one is the only record
 * of how long a given step took.
 * @param verbose - Whether the current run is in `--verbose` mode.
 * @param message - The message to prefix.
 * @returns `message` unchanged, or timestamp-prefixed when `verbose`.
 * @example
 * ```ts
 * formatLogLine(true, 'Extracting archive'); // '2026-08-18T00:00:00.000Z Extracting archive'
 * formatLogLine(false, 'Extracting archive'); // 'Extracting archive'
 * ```
 */
export function formatLogLine(verbose: boolean, message: string): string {
	return verbose ? `${new Date().toISOString()} ${message}` : message;
}
