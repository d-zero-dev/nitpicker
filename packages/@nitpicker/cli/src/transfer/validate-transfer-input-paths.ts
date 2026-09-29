import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Validates every `.nitpicker` archive path an operator gave `concat`/
 * `split` as input: each must exist, be a regular file (a stub crawl
 * directory is rejected explicitly, matching `viewer-build`'s own check),
 * carry the `.nitpicker` extension, and no two arguments may resolve to
 * the same real path (`fs.realpathSync`, so a relative path and its
 * absolute equivalent — or a symlink — are still caught as the same file).
 * @param inputPaths - Raw positional archive-path arguments, as given.
 * @param cwd - Working directory relative paths are resolved against.
 * @returns Each input resolved to an absolute path, in argument order.
 * @throws {Error} On the first validation failure, with an operator-facing message.
 * @example
 * ```ts
 * const absPaths = validateTransferInputPaths(['a.nitpicker', 'b.nitpicker'], process.cwd());
 * ```
 */
export function validateTransferInputPaths(
	inputPaths: readonly string[],
	cwd: string,
): string[] {
	const resolved: string[] = [];
	const seenRealPaths = new Set<string>();
	for (const inputPath of inputPaths) {
		const absPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
		if (!existsSync(absPath)) {
			throw new Error(`Archive not found: ${absPath}`);
		}
		if (!statSync(absPath).isFile()) {
			throw new Error(
				`Not a .nitpicker file (stub crawl directories are not supported): ${absPath}`,
			);
		}
		if (path.extname(absPath) !== '.nitpicker') {
			throw new Error(`Not a .nitpicker file: ${absPath}`);
		}
		const realPath = realpathSync(absPath);
		if (seenRealPaths.has(realPath)) {
			throw new Error(`The same archive was given twice: ${absPath}`);
		}
		seenRealPaths.add(realPath);
		resolved.push(absPath);
	}
	return resolved;
}
