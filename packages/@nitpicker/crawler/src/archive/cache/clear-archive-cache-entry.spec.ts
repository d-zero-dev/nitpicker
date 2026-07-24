import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearArchiveCacheEntry } from './clear-archive-cache-entry.js';

let cacheRoot: string;

beforeEach(async () => {
	cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-clear-entry-test-'));
});

afterEach(async () => {
	await fs.rm(cacheRoot, { recursive: true, force: true });
});

describe('clearArchiveCacheEntry', () => {
	it('returns false and does not throw when the entry does not exist', async () => {
		const missingDir = path.join(cacheRoot, 'missing-entry');
		await expect(clearArchiveCacheEntry(missingDir)).resolves.toBe(false);
	});

	it('returns true and removes only the targeted entry', async () => {
		const targetDir = path.join(cacheRoot, '12345-abcd-target');
		await fs.mkdir(path.join(targetDir, 'nested'), { recursive: true });
		await fs.writeFile(path.join(targetDir, 'db.sqlite'), 'data');

		await expect(clearArchiveCacheEntry(targetDir)).resolves.toBe(true);
		await expect(fs.access(targetDir)).rejects.toThrow();
	});

	it('leaves other tar-cache entries and the table cache untouched', async () => {
		const targetDir = path.join(cacheRoot, '12345-abcd-target');
		const otherEntryDir = path.join(cacheRoot, '67890-abcd-other');
		const tableDir = path.join(cacheRoot, 'table');
		await fs.mkdir(targetDir, { recursive: true });
		await fs.mkdir(otherEntryDir, { recursive: true });
		await fs.mkdir(tableDir, { recursive: true });

		await clearArchiveCacheEntry(targetDir);

		await expect(fs.access(otherEntryDir)).resolves.toBeUndefined();
		await expect(fs.access(tableDir)).resolves.toBeUndefined();
	});

	it('is idempotent — a second call returns false', async () => {
		const targetDir = path.join(cacheRoot, '12345-abcd-target');
		await fs.mkdir(targetDir, { recursive: true });

		await expect(clearArchiveCacheEntry(targetDir)).resolves.toBe(true);
		await expect(clearArchiveCacheEntry(targetDir)).resolves.toBe(false);
	});
});
