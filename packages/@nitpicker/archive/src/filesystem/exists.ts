import { existsSync } from 'node:fs';

/**
 * Checks whether a file or directory exists at the given path.
 * @param filePath - The path to check for existence.
 * @returns `true` if the path exists, `false` otherwise.
 */
export function exists(filePath: string) {
	return existsSync(filePath);
}
