/**
 * Formats and prints a CLI error to stderr.
 *
 * Outputs the error message in `Error: <message>` format.
 * When `verbose` is true and a stack trace is available, it is also printed.
 * Non-Error values are coerced to strings.
 * @param error - The caught error value (may be any type)
 * @param verbose - Whether to include the stack trace in output
 */
export function formatCliError(error: unknown, verbose: boolean): void {
	if (error instanceof Error) {
		// eslint-disable-next-line no-console
		console.error(`Error: ${error.message}`);
		if (verbose && error.stack) {
			// eslint-disable-next-line no-console
			console.error(error.stack);
		}
	} else {
		// eslint-disable-next-line no-console
		console.error(`Error: ${String(error)}`);
	}
}
