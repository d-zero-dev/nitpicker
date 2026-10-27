import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { readWalBytes } from './read-wal-bytes.mjs';

const dirs = [];

afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

/**
 * Creates an empty temporary directory that `afterEach` removes.
 * @returns {Promise<string>} The directory's path.
 */
async function makeDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'read-wal-bytes-'));
	dirs.push(dir);
	return dir;
}

describe('readWalBytes', () => {
	it('returns the size of db.sqlite-wal under the archive directory', async () => {
		const dir = await makeDir();
		await writeFile(path.join(dir, 'db.sqlite-wal'), Buffer.alloc(4096));
		expect(readWalBytes(dir)).toBe(4096);
	});

	it('returns 0 when there is no WAL file (checkpointed and truncated, or not yet created)', async () => {
		const dir = await makeDir();
		expect(readWalBytes(dir)).toBe(0);
	});

	it('rethrows any other failure, such as a directory path that is a file', async () => {
		const dir = await makeDir();
		const file = path.join(dir, 'not-a-dir');
		await writeFile(file, '');
		expect(() => readWalBytes(file)).toThrow(/ENOTDIR/);
	});
});
