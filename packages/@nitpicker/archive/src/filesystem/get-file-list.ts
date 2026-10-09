import fsx from 'fs-extra';

/**
 * Lists the file names in a directory, optionally filtered by a pattern.
 * @param dirPath - The directory path to list files from.
 * @param filter - An optional RegExp or string pattern to filter file names.
 *   Only file names matching this pattern are included in the result.
 * @returns An array of file names in the directory that match the filter (or all if no filter is provided).
 */
export async function getFileList(dirPath: string, filter?: RegExp | string) {
	const list = await fsx.readdir(dirPath);
	return filter ? list.filter((fileName) => fileName.match(filter)) : list;
}
