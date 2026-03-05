import { promises as fs } from 'node:fs';

import { remove } from './remove.js';

/**
 * Checks whether a value is a {@link NodeJS.ErrnoException}.
 * @param error - The value to check.
 * @returns `true` if the value has a `code` property of type `string`.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return (
		error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string'
	);
}

/**
 * Renames (moves) a file or directory from one path to another.
 *
 * If `override` is `true`, the destination is unconditionally removed
 * before renaming. This avoids a TOCTOU race condition between
 * checking existence and performing the removal.
 *
 * When `fs.rename` fails with `EPERM` (common on Windows due to file locks
 * from antivirus or indexer processes) or `EXDEV` (cross-device move),
 * falls back to a copy-then-remove strategy.
 * @param oldPath - The current path of the file or directory.
 * @param newPath - The new path for the file or directory.
 * @param override - Whether to overwrite the destination if it already exists. Defaults to `false`.
 */
export async function rename(oldPath: string, newPath: string, override = false) {
	if (override) {
		await remove(newPath).catch(() => {});
	}

	try {
		await fs.rename(oldPath, newPath);
	} catch (error) {
		if (isNodeError(error) && (error.code === 'EPERM' || error.code === 'EXDEV')) {
			try {
				await fs.cp(oldPath, newPath, { recursive: true });
			} catch (cpError) {
				await remove(newPath).catch(() => {});
				throw cpError;
			}
			await remove(oldPath);
		} else {
			throw error;
		}
	}
}
