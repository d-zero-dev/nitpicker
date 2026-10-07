import type { ParsedHeader } from './types.js';

import fs from 'node:fs/promises';

import { parseHeaderLine } from './parse-header-line.js';

/**
 * Reads request headers from a file, one `Name: value` per line.
 *
 * Blank lines and `#` comment lines are skipped (same conventions as the URL
 * list files). A malformed line fails the whole read with its 1-based line
 * number, so the operator can find it without the value ever being printed.
 *
 * WHY a file: a header value passed as a flag lands in shell history and the
 * process list (`ps`); a file with `chmod 600` does not.
 * @param filePath - Path to the header file (resolved against the cwd).
 * @returns The parsed headers in file order.
 * @throws {Error} When the file cannot be read or a line is invalid.
 * @example
 * // headers.txt:
 * //   # staging
 * //   Authorization: Bearer abc
 * await readHeaderFile('headers.txt');
 * // => [{ name: 'Authorization', value: 'Bearer abc' }]
 */
export async function readHeaderFile(filePath: string): Promise<ParsedHeader[]> {
	const text = await fs.readFile(filePath, 'utf8');
	const headers: ParsedHeader[] = [];
	for (const [index, raw] of text.split(/\r?\n/).entries()) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) {
			continue;
		}
		try {
			headers.push(parseHeaderLine(line));
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${filePath}:${index + 1}: ${reason}`, { cause: error });
		}
	}
	return headers;
}
