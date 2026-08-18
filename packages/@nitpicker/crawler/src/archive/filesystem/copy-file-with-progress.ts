import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/**
 * Copies a file while reporting byte progress — `fs.copyFile` offers no
 * observability, and a `.nitpicker` archive's `.bak` safety copy (taken
 * before every mutating `viewer-build`/`crawl --append`/`--inventory`/
 * `--retry-failed` run, and copied back on failure) can be 15 GB+, running
 * for tens of seconds with nothing on screen (issue #294). Byte granularity
 * is the read-stream chunk size (~64 KB); callers wanting coarser updates
 * throttle in their own callback.
 * @param src - The file to copy.
 * @param dest - The destination path, overwritten if present.
 * @param onProgress - Called as bytes are copied, with the bytes copied so
 *   far and the source file's total size. Omit for a silent copy.
 * @example
 * ```ts
 * await copyFileWithProgress(archivePath, `${archivePath}.bak`, (copied, total) => {
 *   console.error(`${copied}/${total}`);
 * });
 * ```
 */
export async function copyFileWithProgress(
	src: string,
	dest: string,
	onProgress?: (copiedBytes: number, totalBytes: number) => void,
): Promise<void> {
	const { size: totalBytes } = await stat(src);
	const source = createReadStream(src);
	let copiedBytes = 0;
	if (onProgress) {
		source.on('data', (chunk: string | Buffer) => {
			copiedBytes += chunk.length;
			onProgress(copiedBytes, totalBytes);
		});
	}
	await pipeline(source, createWriteStream(dest));
}
