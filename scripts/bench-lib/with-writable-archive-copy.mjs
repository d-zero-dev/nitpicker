/* eslint-disable import-x/no-extraneous-dependencies */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Archive from '@nitpicker/archive/archive';

import { runThenClose } from './run-then-close.mjs';

/**
 * Extracts the archive's database into a fresh temporary directory, opens
 * it writable, runs `work` on it, then releases it without writing back and
 * deletes the directory — for benches whose target writes (template
 * classification, alias backfill). The source `.nitpicker` file is never
 * touched, and the directory is deleted even when releasing the handle
 * fails. A process killed mid-run (Ctrl-C) leaves it behind in the OS temp
 * directory as `nitpicker-bench-*`.
 * @template T
 * @param {string} archivePath - The `.nitpicker` file.
 * @param {(archive: Archive) => Promise<T>} work - The measurement; the
 *   archive is also an `ArchiveAccessor`.
 * @returns {Promise<T>} What `work` resolved to.
 * @example
 * await withWritableArchiveCopy(archivePath, (archive) => backfillAliasOfId(archive));
 */
export async function withWritableArchiveCopy(archivePath, work) {
	const workDir = await mkdtemp(path.join(tmpdir(), 'nitpicker-bench-'));
	const removeWorkDir = () => rm(workDir, { recursive: true, force: true });
	let archive;
	try {
		archive = await Archive.open({ filePath: path.resolve(archivePath), cwd: workDir });
	} catch (error) {
		await removeWorkDir();
		throw error;
	}
	return runThenClose(
		() => work(archive),
		async () => {
			try {
				await archive.releaseHandle();
			} finally {
				await removeWorkDir();
			}
		},
	);
}
