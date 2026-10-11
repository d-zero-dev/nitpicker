import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** `bench-output/` at the repository root (gitignored). */
const DEFAULT_DIRECTORY = path.resolve(import.meta.dirname, '..', '..', 'bench-output');

/**
 * Saves bench records as `<name>-<timestamp>.json` (tab-indented), so runs
 * accumulate instead of overwriting each other.
 * @param {{ name: string; data: unknown; directory?: string; now?: Date }} params
 *   The file name stem (`body-hash-rust`, `suite`), the record or records,
 *   the directory (default: `bench-output/` at the repository root) and the
 *   timestamp (default: now).
 * @returns {Promise<string>} The written file's path.
 * @example
 * const file = await writeBenchOutput({ name: 'suite', data: records });
 */
export async function writeBenchOutput(params) {
	const directory = params.directory ?? DEFAULT_DIRECTORY;
	await mkdir(directory, { recursive: true });
	const stamp = (params.now ?? new Date()).toISOString().replaceAll(/[:.]/g, '-');
	const file = path.join(directory, `${params.name}-${stamp}.json`);
	await writeFile(file, `${JSON.stringify(params.data, null, '\t')}\n`);
	return file;
}
