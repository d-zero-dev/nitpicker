/**
 * Formats an `onExtractProgress` byte pair as an `"Extracting archive: N/M
 * MB"` line for this server's stderr diagnostic channel (issue #294).
 *
 * `totalMB` is floored at `1` for a non-zero `totalBytes` — mirrors
 * `@nitpicker/cli`'s `create-byte-progress-logger.ts` (this package cannot
 * depend on `@nitpicker/cli`, so the fix is duplicated rather than shared):
 * an archive under ~500 KB would otherwise round to `0 MB` and
 * `formatExtractProgressLine` would read as "nothing to do" throughout
 * extraction instead of "in progress". `readMB` is likewise clamped to
 * `totalMB` once `readBytes` reaches `totalBytes`, so a sub-500 KB archive
 * still reads `1/1 MB` at completion rather than stalling at `0/1 MB`.
 * @param readBytes - Bytes read so far.
 * @param totalBytes - Total archive size in bytes.
 * @returns The rendered line, e.g. `"Extracting archive: 50/200 MB"`.
 * @example
 * formatExtractProgressLine(50_000_000, 200_000_000); // 'Extracting archive: 50/200 MB'
 * formatExtractProgressLine(400_000, 400_000); // 'Extracting archive: 1/1 MB'
 */
export function formatExtractProgressLine(readBytes: number, totalBytes: number): string {
	const totalMB = totalBytes > 0 ? Math.max(1, Math.round(totalBytes / 1_000_000)) : 0;
	const readMB =
		totalBytes > 0 && readBytes >= totalBytes
			? totalMB
			: Math.min(totalMB, Math.round(readBytes / 1_000_000));
	return `Extracting archive: ${readMB}/${totalMB} MB`;
}
