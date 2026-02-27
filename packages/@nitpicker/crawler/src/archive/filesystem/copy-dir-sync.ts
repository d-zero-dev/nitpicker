import fsx from 'fs-extra';

/**
 * Synchronously copies a directory and its contents from one location to another.
 * @param from - The source directory path to copy from.
 * @param to - The destination directory path to copy to.
 */
export function copyDirSync(from: string, to: string) {
	fsx.copySync(from, to);
}
