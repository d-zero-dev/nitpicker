import { extract } from 'tar';

/**
 * Extracts files from a TAR archive.
 *
 * Only files newer than existing files in the target directory are extracted
 * (uses the `newer` option). Optionally restricts extraction to a specific
 * working directory and/or a subset of files.
 * @param tarFilePath - The path to the TAR archive to extract.
 * @param options - Optional extraction settings.
 * @param options.cwd - The working directory to extract files into.
 *   If omitted, the current working directory is used.
 * @param options.fileList - An array of specific file paths within the archive
 *   to extract. If omitted, all files in the archive are extracted.
 * @returns A promise that resolves when extraction is complete.
 */
export function untar(
	tarFilePath: string,
	options?: {
		/** The working directory to extract files into. */
		cwd?: string;
		/** An array of specific file paths within the archive to extract. */
		fileList?: string[];
	},
) {
	return extract(
		{
			file: tarFilePath,
			newer: true,
			cwd: options?.cwd,
			preservePaths: false,
			noMtime: true,
		},
		options?.fileList ?? [],
	);
}
