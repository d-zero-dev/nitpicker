import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolveOutputPath } from '@nitpicker/crawler';

/**
 * Resolves and validates the `-o/--output` path for `concat`/`split`.
 *
 * Reuses {@link resolveOutputPath} (the exact same normalisation
 * `crawl --output`/`pipeline` apply: relative → absolute, `.nitpicker`
 * appended if missing, parent directory must exist) and adds three
 * refusals specific to a command that CREATES a brand-new archive rather
 * than resuming/appending an existing one — `concat`/`split` never
 * overwrite:
 *
 * - The resolved path must not already exist (a stale `.nitpicker` file).
 * - Its sibling extension-less directory (`Archive.write()`'s rename
 *   target — see `filesystem/rename.ts`) must not already exist, or
 *   `write()` would silently `rm -rf` it.
 * - Its `._nitpicker-<basename>` tmpDir must not already exist (a stale
 *   stub from an unrelated interrupted session, or `Archive.create`'s
 *   lock would collide).
 * @param output - The raw `-o/--output` flag value.
 * @param cwd - Working directory relative paths are resolved against.
 * @returns The resolved absolute output path.
 * @throws {Error} On any of the checks above, with an operator-facing message.
 * @example
 * ```ts
 * const outputPath = validateTransferOutputPath('merged', process.cwd());
 * ```
 */
export function validateTransferOutputPath(output: string, cwd: string): string {
	const resolved = resolveOutputPath(output, cwd);

	if (existsSync(resolved)) {
		throw new Error(`Output already exists: ${resolved}`);
	}

	const dir = path.dirname(resolved);
	const basename = path.basename(resolved, path.extname(resolved));
	const siblingDir = path.join(dir, basename);
	if (existsSync(siblingDir)) {
		throw new Error(
			`A directory already exists at the output's write target: ${siblingDir} — remove it or choose a different output path.`,
		);
	}

	const tmpDir = path.join(dir, `._nitpicker-${basename}`);
	if (existsSync(tmpDir)) {
		throw new Error(
			`A stale working directory already exists: ${tmpDir} — remove it or choose a different output path.`,
		);
	}

	return resolved;
}
