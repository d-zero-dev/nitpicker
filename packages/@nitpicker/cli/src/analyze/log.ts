import type { Nitpicker } from '@nitpicker/core';

/**
 * Registers event listeners on a Nitpicker instance for analyze output,
 * and prints the initial summary lines.
 *
 * Outputs the start log lines (site URL, file path), then listens for
 * `writeFile` and `error` events to provide CLI feedback.
 * Progress display is handled by Lanes in the calling code.
 * @param nitpicker - The Nitpicker instance to listen on
 * @param startLog - Lines to display at the start (URL + file path summary)
 */
export function log(nitpicker: Nitpicker, startLog: string[]): void {
	for (const line of startLog) {
		// eslint-disable-next-line no-console
		console.log(line);
	}

	nitpicker.on('writeFile', ({ filePath }) => {
		// eslint-disable-next-line no-console
		console.log(`  📥 Write file: ${filePath}`);
	});

	nitpicker.on('error', (err) => {
		// eslint-disable-next-line no-console
		console.error(err.message);
	});
}
