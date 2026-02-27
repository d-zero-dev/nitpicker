import fsx from 'fs-extra';

/**
 * Recursively copies a directory and its contents from one location to another.
 * @param from - The source directory path to copy from.
 * @param to - The destination directory path to copy to.
 * @returns `true` if the copy succeeded, `false` if an error occurred.
 */
export async function copyDir(from: string, to: string) {
	return fsx
		.copy(from, to)
		.then(() => true)
		.catch(() => false);
}
