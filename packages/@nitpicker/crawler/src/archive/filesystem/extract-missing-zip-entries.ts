import { promises as fs } from 'node:fs';

import { extractZip } from '@d-zero/fs/zip';

import { safePath } from '../safe-path.js';

import { exists } from './exists.js';
import { mkdir } from './mkdir.js';

/**
 * Extracts the entries of a zip file into a directory, skipping any entry
 * whose destination file already exists — existing files always win.
 *
 * Used by `Archive.write()` in the append flow to merge previously zipped
 * snapshots with snapshots newly written during the session, without letting
 * stale zip entries overwrite fresh files.
 * @param zipFilePath - The absolute path to the source zip file.
 * @param destDir - The absolute path of the directory to extract into.
 */
export async function extractMissingZipEntries(zipFilePath: string, destDir: string) {
	const dir = await extractZip(zipFilePath);
	for (const file of dir.files) {
		if (file.type !== 'File') {
			continue;
		}
		const dest = safePath(destDir, file.path);
		if (exists(dest)) {
			continue;
		}
		mkdir(dest);
		await fs.writeFile(dest, await file.buffer());
	}
}
