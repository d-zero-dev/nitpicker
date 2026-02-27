import { promises as fs } from 'node:fs';

/**
 * Reads the entire contents of a text file as a UTF-8 string.
 * @param filePath - The absolute or relative path to the text file to read.
 * @returns The text content of the file.
 */
export async function readText(filePath: string) {
	const data = await fs.readFile(filePath, { encoding: 'utf8' });
	return data;
}
