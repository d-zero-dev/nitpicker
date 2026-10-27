import { statSync } from 'node:fs';
import path from 'node:path';

/**
 * Returns the current size of the archive's WAL file (`db.sqlite-wal` under
 * the extracted directory). The read model build writes every row into the
 * WAL until its one transaction commits, so sampling this at phase
 * boundaries shows how much of the build's memory tracks the uncommitted
 * write set. Synchronous for the same reason as {@link readMemoryRegions}.
 * @param {string} tmpDir - The archive's extracted directory
 *   (`accessor.tmpDir`).
 * @returns {number} Bytes: 0 after a `wal_checkpoint(TRUNCATE)` (the file
 *   stays, cut to zero bytes), and 0 when there is no WAL file yet.
 * @example
 * const walBytes = readWalBytes(archive.tmpDir);
 */
export function readWalBytes(tmpDir) {
	try {
		return statSync(path.join(tmpDir, 'db.sqlite-wal')).size;
	} catch (error) {
		if (error.code === 'ENOENT') {
			return 0;
		}
		throw error;
	}
}
