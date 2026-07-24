import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listArchiveCacheEntries } from './list-archive-cache-entries.js';

let cacheRoot: string;

beforeEach(async () => {
	cacheRoot = path.join(
		await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-list-entries-test-')),
		'cache',
	);
});

afterEach(async () => {
	await fs.rm(path.dirname(cacheRoot), { recursive: true, force: true });
});

describe('listArchiveCacheEntries', () => {
	it('returns an empty array when the cache root does not exist', async () => {
		await expect(listArchiveCacheEntries(cacheRoot)).resolves.toEqual([]);
	});

	it('returns an empty array for an empty cache root', async () => {
		await fs.mkdir(cacheRoot, { recursive: true });
		await expect(listArchiveCacheEntries(cacheRoot)).resolves.toEqual([]);
	});

	it('re-throws errors other than ENOENT', async () => {
		// Pointing cacheRoot at a plain file makes fs.readdir fail with ENOTDIR.
		await fs.mkdir(path.dirname(cacheRoot), { recursive: true });
		await fs.writeFile(cacheRoot, 'not a directory');
		await expect(listArchiveCacheEntries(cacheRoot)).rejects.toThrow();
	});

	it('classifies a directory named "table" as kind "table"', async () => {
		await fs.mkdir(path.join(cacheRoot, 'table'), { recursive: true });
		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: 'table', name: 'table' });
	});

	it('classifies a cache-key-shaped directory as kind "tar-cache"', async () => {
		await fs.mkdir(path.join(cacheRoot, '12345-999-888-abcd-abcd-example'), {
			recursive: true,
		});
		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.kind).toBe('tar-cache');
	});

	it('does not misclassify a tar-cache entry whose basename merely contains ".corrupt." as an orphan', async () => {
		// Archive named e.g. `my.corrupt.report.nitpicker` -> sanitized
		// basename `my.corrupt.report`, which does NOT end in the real
		// quarantine suffix shape `.corrupt.<pid>.<n>`.
		await fs.mkdir(path.join(cacheRoot, '12345-abcd-my.corrupt.report'), {
			recursive: true,
		});
		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.kind).toBe('tar-cache');
	});

	it('classifies ".staging" and ".corrupt.*" directories as kind "orphan"', async () => {
		await fs.mkdir(path.join(cacheRoot, '12345-abcd-example.staging'), {
			recursive: true,
		});
		await fs.mkdir(path.join(cacheRoot, '12345-abcd-example.corrupt.999.1'), {
			recursive: true,
		});
		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries).toHaveLength(2);
		for (const entry of entries) {
			expect(entry.kind).toBe('orphan');
		}
	});

	it('classifies a non-directory entry as kind "unknown" and uses its own stat', async () => {
		await fs.mkdir(cacheRoot, { recursive: true });
		const filePath = path.join(cacheRoot, 'stray-file.txt');
		await fs.writeFile(filePath, 'hello');
		const stat = await fs.stat(filePath);

		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: 'unknown',
			name: 'stray-file.txt',
			sizeBytes: stat.size,
			mtimeMs: stat.mtimeMs,
		});
	});

	it('sums the sizes of nested files recursively', async () => {
		const entryDir = path.join(cacheRoot, '12345-abcd-example');
		await fs.mkdir(path.join(entryDir, 'nested'), { recursive: true });
		await fs.writeFile(path.join(entryDir, 'db.sqlite'), Buffer.alloc(100, 'a'));
		await fs.writeFile(path.join(entryDir, 'nested', 'file.json'), Buffer.alloc(50, 'b'));

		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.sizeBytes).toBe(150);
	});

	it('reports the most recent mtime found among nested files', async () => {
		const entryDir = path.join(cacheRoot, '12345-abcd-example');
		await fs.mkdir(entryDir, { recursive: true });
		const olderFile = path.join(entryDir, 'older.txt');
		const newerFile = path.join(entryDir, 'newer.txt');
		await fs.writeFile(olderFile, 'old');
		await fs.writeFile(newerFile, 'new');

		const older = new Date('2020-01-01T00:00:00Z');
		const newer = new Date('2030-01-01T00:00:00Z');
		await fs.utimes(olderFile, older, older);
		await fs.utimes(newerFile, newer, newer);

		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries[0]?.mtimeMs).toBe(newer.getTime());
	});

	it("falls back to the directory's own mtime when it contains no files", async () => {
		const entryDir = path.join(cacheRoot, '12345-abcd-empty');
		await fs.mkdir(entryDir, { recursive: true });
		const dirStat = await fs.stat(entryDir);

		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries[0]?.mtimeMs).toBe(dirStat.mtimeMs);
	});

	it('does not follow a top-level symbolic link and reports it with zero size', async () => {
		const targetDir = path.join(path.dirname(cacheRoot), 'link-target');
		await fs.mkdir(path.join(targetDir, 'nested'), { recursive: true });
		await fs.writeFile(path.join(targetDir, 'nested', 'file.txt'), 'content');
		await fs.mkdir(cacheRoot, { recursive: true });
		await fs.symlink(targetDir, path.join(cacheRoot, 'link'), 'dir');

		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: 'unknown', name: 'link', sizeBytes: 0 });
	});

	it('does not crash on a dangling symbolic link', async () => {
		await fs.mkdir(cacheRoot, { recursive: true });
		await fs.symlink(
			path.join(cacheRoot, 'does-not-exist'),
			path.join(cacheRoot, 'dangling-link'),
		);

		await expect(listArchiveCacheEntries(cacheRoot)).resolves.toHaveLength(1);
	});

	it('does not follow a symbolic link nested inside a tar-cache entry', async () => {
		const targetDir = path.join(path.dirname(cacheRoot), 'nested-link-target');
		await fs.mkdir(targetDir, { recursive: true });
		await fs.writeFile(path.join(targetDir, 'big-file.txt'), Buffer.alloc(1000, 'x'));

		const entryDir = path.join(cacheRoot, '12345-abcd-example');
		await fs.mkdir(entryDir, { recursive: true });
		await fs.writeFile(path.join(entryDir, 'small-file.txt'), Buffer.alloc(10, 'y'));
		await fs.symlink(targetDir, path.join(entryDir, 'linked'), 'dir');

		const entries = await listArchiveCacheEntries(cacheRoot);
		expect(entries[0]?.sizeBytes).toBe(10);
	});

	it('returns all entries when tar-cache, table, and orphan kinds are mixed', async () => {
		await fs.mkdir(path.join(cacheRoot, '11111-abcd-one'), { recursive: true });
		await fs.mkdir(path.join(cacheRoot, '22222-abcd-two.staging'), { recursive: true });
		await fs.mkdir(path.join(cacheRoot, 'table'), { recursive: true });

		const entries = await listArchiveCacheEntries(cacheRoot);
		const kinds = entries.map((entry) => entry.kind).toSorted();
		expect(kinds).toEqual(['orphan', 'table', 'tar-cache']);
	});
});
