import { promises as fs } from 'node:fs';

import { remove } from './remove.js';

/**
 * Renames (moves) a file or directory from one path to another.
 *
 * If `override` is `true`, the destination is unconditionally removed
 * before renaming. This avoids a TOCTOU race condition between
 * checking existence and performing the removal.
 * @param oldPath - The current path of the file or directory.
 * @param newPath - The new path for the file or directory.
 * @param override - Whether to overwrite the destination if it already exists. Defaults to `false`.
 */
export async function rename(oldPath: string, newPath: string, override = false) {
	if (override) {
		await remove(newPath).catch(() => {});
	}

	await fs.rename(oldPath, newPath);
}
