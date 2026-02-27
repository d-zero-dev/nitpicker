import path from 'node:path';

import { create } from 'tar';

/**
 * Creates an uncompressed TAR archive from a directory.
 *
 * The archive preserves the relative directory structure.
 * The `dir` parameter is resolved relative to its parent directory
 * so only the target directory name appears in the archive.
 * @param dir - The absolute path of the directory to archive.
 * @param outputPath - The file path where the TAR archive will be written.
 * @returns A promise that resolves when the TAR archive has been created.
 */
export function tar(dir: string, outputPath: string) {
	const baseDir = path.dirname(dir);
	const targetDir = path.relative(baseDir, dir);
	return create(
		{
			gzip: false,
			cwd: baseDir,
			file: outputPath,
			preservePaths: false,
		},
		[targetDir],
	);
}
