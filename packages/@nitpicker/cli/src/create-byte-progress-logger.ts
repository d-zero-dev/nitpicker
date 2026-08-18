import { formatByteProgress } from './format-byte-progress.js';

/**
 * Builds a byte-progress callback that renders `<label>: N/M MB (x%)` lines,
 * deduplicated on the rendered message — the underlying byte callbacks (tar
 * extraction/creation, `.bak` backup/restore copies) fire per ~64 KB stream
 * chunk, far denser than a display needs, and keying on the formatted string
 * (not a raw percent) dedupes whichever of the MB count or the percent
 * happens to be the coarser unit for a given archive's size (issue #294).
 *
 * Takes a `logLine` sink rather than a `Lanes` instance directly: display
 * concerns (which lane, `--verbose` timestamp-prefixing) stay in the
 * caller's own `logLine` helper, so this function's only job is turning
 * byte counts into a de-duplicated message string.
 *
 * The MB counts are rounded for display, but the total is never rounded down
 * to `0` for a genuinely non-zero `totalBytes` (an archive under ~500 KB
 * would otherwise read `formatProgressCount`'s `total === 0` as "nothing to
 * do" and render a false `100%` before extraction even starts) — a non-zero
 * total is floored at `1` MB instead, and the processed count is clamped to
 * that total once `bytes` reaches it so completion still reads `100%`.
 * @param logLine - Called with the rendered message whenever it changes.
 * @param label - The line's label, e.g. `"Extracting archive"`.
 * @param options - Rendering options.
 * @param options.animated - Whether to prefix the message with the
 *   `%braille%` animation placeholder `Lanes`' `riffle()` replaces with a
 *   spinner glyph. Defaults to `true`. Pass `false` for a `logLine` sink that
 *   writes straight to a stream instead of through a `Lanes` instance — the
 *   placeholder would otherwise leak into the output as literal text.
 * @returns A `(bytes, totalBytes)` callback suitable for
 *   `onExtractProgress`/`onTarProgress`/`copyFileWithProgress`.
 * @example
 * ```ts
 * await Archive.open({
 *   filePath,
 *   openPluginData: true,
 *   onExtractProgress: createByteProgressLogger(
 *     (message) => logLine(lanes, flags.verbose, message),
 *     'Extracting archive',
 *   ),
 * });
 * ```
 */
export function createByteProgressLogger(
	logLine: (message: string) => void,
	label: string,
	options?: {
		/** Prefix the message with the `%braille%` animation placeholder. Defaults to `true`. */
		animated?: boolean;
	},
): (bytes: number, totalBytes: number) => void {
	const prefix = (options?.animated ?? true) ? '%braille% ' : '';
	let lastMessage = '';
	return (bytes, totalBytes) => {
		const message = `${prefix}${label}: ${formatByteProgress(bytes, totalBytes)}`;
		if (message === lastMessage) {
			return;
		}
		lastMessage = message;
		logLine(message);
	};
}
