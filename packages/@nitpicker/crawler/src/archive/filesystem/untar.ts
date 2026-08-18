import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { extract } from 'tar';

/**
 * Extracts files from a TAR archive.
 *
 * Only files newer than existing files in the target directory are extracted
 * (uses the `newer` option). Optionally restricts extraction to a specific
 * working directory and/or a subset of files.
 *
 * When `onProgress` is given, the tar is read through a manual
 * `createReadStream` pipe instead of tar's own `file` mode so the consumed
 * byte count can be observed — a `.nitpicker` tar is dominated by the single
 * giant `db.sqlite` entry (15 GB+ on large crawls), so per-entry callbacks
 * would fire once and report nothing for minutes (issue #294). Byte
 * granularity is the read-stream chunk size (~64 KB); callers wanting
 * coarser updates (e.g. one per percent) throttle in their own callback.
 * @param tarFilePath - The path to the TAR archive to extract.
 * @param options - Optional extraction settings.
 * @param options.cwd - The working directory to extract files into.
 *   If omitted, the current working directory is used.
 * @param options.fileList - An array of specific file paths within the archive
 *   to extract. If omitted, all files in the archive are extracted.
 * @param options.onProgress - Called as archive bytes are consumed, with the
 *   bytes read so far and the archive's total size. Omit for the original
 *   silent, tar-managed-file extraction.
 * @returns A promise that resolves when extraction is complete.
 */
export async function untar(
	tarFilePath: string,
	options?: {
		/** The working directory to extract files into. */
		cwd?: string;
		/** An array of specific file paths within the archive to extract. */
		fileList?: string[];
		/** Byte-level progress callback — see the function docs. */
		onProgress?: (readBytes: number, totalBytes: number) => void;
	},
) {
	const { cwd, fileList, onProgress } = options ?? {};
	if (!onProgress) {
		await extract(
			{
				file: tarFilePath,
				newer: true,
				cwd,
				preservePaths: false,
				noMtime: true,
			},
			fileList ?? [],
		);
		return;
	}

	const { size: totalBytes } = await stat(tarFilePath);
	await new Promise<void>((resolve, reject) => {
		const source = createReadStream(tarFilePath);
		let readBytes = 0;
		source.on('data', (chunk) => {
			readBytes += chunk.length;
			onProgress(readBytes, totalBytes);
		});
		const sink = extract(
			{
				newer: true,
				cwd,
				preservePaths: false,
				noMtime: true,
			},
			fileList ?? [],
		);
		// .pipe() does not destroy the other side on error, so an error on
		// either stream would otherwise leave the write side dangling open.
		// `Unpack` (`extends Parser extends EE`, a plain `EventEmitter`, NOT
		// a Minipass/stream base class despite behaving like a writable
		// stream) has no `destroy()` — `abort()` is its own equivalent:
		// idempotent (guarded internally), and it emits its own 'error'
		// (confirmed via `tar`'s `warnMethod` with `recoverable: false`),
		// which re-enters the `sink.on('error', ...)` handler below —
		// harmless, since `source.destroy()`/`reject()` are already
		// idempotent no-ops on a second call.
		source.on('error', (error: unknown) => {
			const err = error instanceof Error ? error : new Error(String(error));
			sink.abort(err);
			reject(err);
		});
		sink.on('error', (error: unknown) => {
			const err = error instanceof Error ? error : new Error(String(error));
			source.destroy(err);
			reject(err);
		});
		// node-tar's Unpack stream signals completion via 'close' (all entry
		// writes flushed), not 'finish' (input fully consumed) — resolving on
		// 'finish' could hand the caller a tmpDir whose db.sqlite is still
		// being written.
		sink.on('close', () => {
			resolve();
		});
		source.pipe(sink);
	});
}
