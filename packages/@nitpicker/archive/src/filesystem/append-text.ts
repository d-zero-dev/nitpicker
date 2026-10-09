import { promises as fs } from 'node:fs';

import { mkdir } from './mkdir.js';

/**
 * Appends text data to a file at the specified path.
 *
 * Creates parent directories if they do not exist.
 * A newline character is prepended to the data before appending.
 * @param filePath - The absolute or relative path to the file to append to.
 * @param data - The text content to append to the file.
 */
export async function appendText(filePath: string, data: string) {
	mkdir(filePath);
	await fs.appendFile(filePath, `\n${data}`, { encoding: 'utf8' });
}
