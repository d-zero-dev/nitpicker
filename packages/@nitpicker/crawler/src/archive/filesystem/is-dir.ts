import fsx from 'fs-extra';

/**
 * Checks whether the given path points to a directory.
 * @param dirPath - The path to check.
 * @returns `true` if the path is a directory, `false` otherwise.
 */
export async function isDir(dirPath: string) {
	const stat = await fsx.stat(dirPath);
	return stat.isDirectory();
}
