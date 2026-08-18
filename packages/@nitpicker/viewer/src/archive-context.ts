import type { ArchiveContext } from './types.js';

import { ArchiveManager } from '@nitpicker/query';

/**
 * Opens an archive source and builds the long-lived server context.
 *
 * The viewer serves a single source fixed at launch time, so one manager
 * holds one opened entry for the whole process lifetime.
 *
 * Two source kinds are accepted, dispatched by {@link ArchiveManager.open}:
 *
 * - **A `.nitpicker` file** — the finished archive, extracted into a tmpDir
 *   owned by the manager.
 * - **A crawl stub directory** — an in-progress (or interrupted) crawl's
 *   tmpDir, read in place. Cleanup never touches this directory, so it
 *   stays available for `crawl --resume`.
 *
 * The detected mode is forwarded on the context so the frontend can surface
 * "snapshot of an in-progress crawl" to the user.
 * @param filePath - Path to a `.nitpicker` file or a stub directory.
 * @param onExtractProgress - Forwarded to `ArchiveManager`'s constructor —
 *   called during a cold `open()`'s untar step with bytes read so far and
 *   the archive's total size (issue #294: a large archive's first open can
 *   take tens of seconds with no other signal it isn't hung).
 * @returns The archive context to pass to `createApp`.
 * @throws {Error} If the path is missing, unreadable, or is neither a
 *   `.nitpicker` file nor a directory containing `db.sqlite`.
 */
export async function createArchiveContext(
	filePath: string,
	onExtractProgress?: (readBytes: number, totalBytes: number) => void,
): Promise<ArchiveContext> {
	const manager = new ArchiveManager({ onExtractProgress });
	const { archiveId, mode, crawlerLockHolder } = await manager.open(filePath);
	return { manager, archiveId, filePath, mode, crawlerLockHolder };
}
