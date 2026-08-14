/**
 * Formats and prints a CLI error to stderr.
 *
 * Outputs the error message in `Error: <message>` format.
 * When `verbose` is true and a stack trace is available, it is also printed.
 * Non-Error values are coerced to strings.
 *
 * `SuppressedError` (thrown when an `await using`/`using` block's body and
 * its resource's `[Symbol.asyncDispose]`/`[Symbol.dispose]` both fail) is
 * unwrapped recursively: its own `.message` is only the generic "An error
 * was suppressed during disposal", so both `.error` (the disposal failure
 * that actually propagates) and `.suppressed` (the original body failure,
 * hidden behind it) are printed as well — otherwise either underlying
 * cause would be invisible to the operator.
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
		if (error instanceof SuppressedError) {
			// eslint-disable-next-line no-console
			console.error('Error during resource cleanup:');
			formatCliError(error.error, verbose);
			// eslint-disable-next-line no-console
			console.error('Suppressed original error:');
			formatCliError(error.suppressed, verbose);
		}
	} else {
		// eslint-disable-next-line no-console
		console.error(`Error: ${String(error)}`);
	}
}
