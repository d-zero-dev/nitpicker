import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Ensures the parent directory of the given file path exists.
 *
 * If the parent directory does not exist, it is created recursively
 * with permissions `0o700` (owner-only access).
 * @param filePath - The file path whose parent directory should be created.
 */
export function mkdir(filePath: string) {
	const { dir } = path.parse(filePath);
	if (!existsSync(dir)) {
		mkdirSync(path.resolve(dir), { recursive: true, mode: 0o700 });
	}
}
