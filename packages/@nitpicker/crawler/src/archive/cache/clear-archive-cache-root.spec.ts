import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearArchiveCacheRoot } from './clear-archive-cache-root.js';

let parentDir: string;
let cacheRoot: string;

beforeEach(async () => {
	parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-clear-root-test-'));
	cacheRoot = path.join(parentDir, 'cache');
});

afterEach(async () => {
	await fs.rm(parentDir, { recursive: true, force: true });
});

describe('clearArchiveCacheRoot', () => {
	it('returns false and does not throw when the root does not exist', async () => {
		await expect(clearArchiveCacheRoot(cacheRoot)).resolves.toBe(false);
	});

	it('returns true and removes an existing root, including tar-cache and table entries', async () => {
		await fs.mkdir(path.join(cacheRoot, '12345-abcd-example'), { recursive: true });
		await fs.mkdir(path.join(cacheRoot, 'table'), { recursive: true });

		await expect(clearArchiveCacheRoot(cacheRoot)).resolves.toBe(true);
		await expect(fs.access(cacheRoot)).rejects.toThrow();
	});

	it('is idempotent — a second call returns false', async () => {
		await fs.mkdir(cacheRoot, { recursive: true });

		await expect(clearArchiveCacheRoot(cacheRoot)).resolves.toBe(true);
		await expect(clearArchiveCacheRoot(cacheRoot)).resolves.toBe(false);
	});

	it('does not remove a sibling directory next to the cache root', async () => {
		const siblingDir = path.join(parentDir, 'sibling');
		await fs.mkdir(cacheRoot, { recursive: true });
		await fs.mkdir(siblingDir, { recursive: true });

		await clearArchiveCacheRoot(cacheRoot);

		await expect(fs.access(siblingDir)).resolves.toBeUndefined();
	});
});
