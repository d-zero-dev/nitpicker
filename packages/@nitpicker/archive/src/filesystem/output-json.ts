import { promises as fs } from 'node:fs';

import { mkdir } from './mkdir.js';

/**
 * Writes data to a JSON file at the specified path.
 *
 * Creates parent directories if they do not exist.
 * The output is formatted with 2-space indentation.
 * @param filePath - The absolute or relative path to the JSON file to write.
 * @param data - The data to serialize as JSON and write to the file.
 */
export async function outputJSON(filePath: string, data: unknown) {
	mkdir(filePath);
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
}
