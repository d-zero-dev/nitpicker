import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { create } from 'tar';

/**
 * Creates an uncompressed TAR archive from a directory.
 *
 * The archive preserves the relative directory structure.
 * The `dir` parameter is resolved relative to its parent directory
 * so only the target directory name appears in the archive.
 *
 * When `onProgress` is given, the tar is produced through a manual stream
 * pipe instead of tar's own `file` mode so the written byte count can be
 * observed — a `.nitpicker` tar is dominated by the single giant `db.sqlite`
 * entry (15 GB+ on large crawls), so per-entry callbacks would fire once and
 * report nothing for minutes (issue #294). `totalBytes` is an estimate (the
 * sum of the directory's file sizes; tar adds per-entry headers and padding
 * on top), so `writtenBytes` is clamped to it and a final
 * `(totalBytes, totalBytes)` call marks completion.
 * @param dir - The absolute path of the directory to archive.
 * @param outputPath - The file path where the TAR archive will be written.
 * @param onProgress - Called as archive bytes are written, with the bytes
 *   written so far (clamped to the estimate) and the estimated total. Omit
 *   for the original silent, tar-managed-file creation.
 * @returns A promise that resolves when the TAR archive has been created.
 */
export async function tar(
	dir: string,
	outputPath: string,
	onProgress?: (writtenBytes: number, totalBytes: number) => void,
) {
	const baseDir = path.dirname(dir);
	const targetDir = path.relative(baseDir, dir);
	if (!onProgress) {
		await create(
			{
				gzip: false,
				cwd: baseDir,
				file: outputPath,
				preservePaths: false,
			},
			[targetDir],
		);
		return;
	}

	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	let totalBytes = 0;
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const { size } = await stat(path.join(entry.parentPath, entry.name));
		totalBytes += size;
	}

	await new Promise<void>((resolve, reject) => {
		const source = create(
			{
				gzip: false,
				cwd: baseDir,
				preservePaths: false,
			},
			[targetDir],
		);
		const sink = createWriteStream(outputPath);
		let writtenBytes = 0;
		source.on('data', (chunk: Buffer) => {
			writtenBytes += chunk.length;
			onProgress(Math.min(writtenBytes, totalBytes), totalBytes);
		});
		// .pipe() does not destroy the other side on error, so an error on
		// either stream would otherwise leave the write side dangling open.
		source.on('error', (error: unknown) => {
			const err = error instanceof Error ? error : new Error(String(error));
			sink.destroy(err);
			reject(err);
		});
		sink.on('error', (error: unknown) => {
			const err = error instanceof Error ? error : new Error(String(error));
			source.destroy(err);
			reject(err);
		});
		sink.on('close', () => {
			onProgress(totalBytes, totalBytes);
			resolve();
		});
		source.pipe(sink);
	});
}
