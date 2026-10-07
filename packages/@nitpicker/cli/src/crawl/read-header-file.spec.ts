import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readHeaderFile } from './read-header-file.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-header-file-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Writes `content` to a file inside the temp dir.
 * @param content - File content.
 * @returns The absolute file path.
 */
async function write(content: string) {
	const file = path.join(dir, 'headers.txt');
	await fs.writeFile(file, content);
	return file;
}

describe('readHeaderFile', () => {
	it('reads one header per line in file order', async () => {
		const file = await write('Authorization: Bearer a\nX-Api-Key: k\n');
		expect(await readHeaderFile(file)).toEqual([
			{ name: 'Authorization', value: 'Bearer a' },
			{ name: 'X-Api-Key', value: 'k' },
		]);
	});

	it('skips blank lines and # comments, and tolerates CRLF', async () => {
		const file = await write('# staging\r\n\r\nAuthorization: Bearer a\r\n   \r\n');
		expect(await readHeaderFile(file)).toEqual([
			{ name: 'Authorization', value: 'Bearer a' },
		]);
	});

	it('reports the 1-based line number of a malformed line without its value', async () => {
		const file = await write('Authorization: Bearer a\nnot a header secret-value\n');
		await expect(readHeaderFile(file)).rejects.toThrow(`${file}:2:`);
		const error = await readHeaderFile(file).catch((error_: unknown) => error_ as Error);
		expect((error as Error).message).not.toContain('secret-value');
	});

	it('rejects when the file does not exist', async () => {
		await expect(readHeaderFile(path.join(dir, 'missing.txt'))).rejects.toThrow('ENOENT');
	});
});
