import type { ArchiveContext } from './types.js';

import { ArchiveManager } from '@nitpicker/query';

/**
 * Opens a `.nitpicker` archive and builds the long-lived server context.
 *
 * The viewer serves a single archive fixed at launch time, so one manager
 * holds one opened archive for the whole process lifetime.
 * @param filePath - Path to the `.nitpicker` archive to open.
 * @returns The archive context to pass to `createApp`.
 * @throws {Error} If the file is missing, unreadable, or not a `.nitpicker` archive.
 */
export async function createArchiveContext(filePath: string): Promise<ArchiveContext> {
	const manager = new ArchiveManager();
	const { archiveId } = await manager.open(filePath);
	return { manager, archiveId, filePath };
}
