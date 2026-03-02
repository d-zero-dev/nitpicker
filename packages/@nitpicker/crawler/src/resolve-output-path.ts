import { existsSync } from 'node:fs';
import path from 'node:path';

import Archive from './archive/archive.js';

/**
 * Resolves and validates an output file path for the `.nitpicker` archive.
 *
 * Converts relative paths to absolute using the given working directory,
 * appends the `.nitpicker` extension if missing, and verifies that the
 * parent directory exists.
 * @param outputPath - The user-specified output file path (relative or absolute).
 * @param cwd - The working directory used to resolve relative paths.
 * @returns The resolved absolute file path with the `.nitpicker` extension.
 * @throws {Error} If the parent directory of the resolved path does not exist.
 */
export function resolveOutputPath(outputPath: string, cwd: string): string {
	const resolved = path.isAbsolute(outputPath)
		? outputPath
		: path.resolve(cwd, outputPath);

	const ext = `.${Archive.FILE_EXTENSION}`;
	const withExt = resolved.endsWith(ext) ? resolved : `${resolved}${ext}`;

	const dir = path.dirname(withExt);
	if (!existsSync(dir)) {
		throw new Error(
			`Output directory does not exist: ${dir}. Please create the directory before running the command.`,
		);
	}

	return withExt;
}
