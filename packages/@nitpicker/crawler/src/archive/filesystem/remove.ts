import { promises as fs } from 'node:fs';

/**
 * Recursively removes a file or directory at the specified path.
 * @param dirPath - The path of the file or directory to remove.
 */
export async function remove(dirPath: string) {
	await fs.rm(dirPath, {
		recursive: true,
	});
}
