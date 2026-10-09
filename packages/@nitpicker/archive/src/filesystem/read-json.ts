import { promises as fs } from 'node:fs';

/**
 * Reads and parses a JSON file from the specified path.
 * @template T - The expected type of the parsed JSON content. Defaults to `unknown`.
 * @param filePath - The absolute or relative path to the JSON file to read.
 * @returns The parsed JSON content, cast to the specified generic type.
 */
export async function readJSON<T = unknown>(filePath: string) {
	const data = await fs.readFile(filePath, { encoding: 'utf8' });
	return JSON.parse(data) as T;
}
