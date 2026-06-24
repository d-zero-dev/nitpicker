import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeArchiveCacheKey } from './compute-archive-cache-key.js';

const baseDir = path.resolve(os.tmpdir(), `nitpicker-cache-key-test-${process.pid}`);

beforeEach(async () => {
	await fs.mkdir(baseDir, { recursive: true });
});

afterEach(async () => {
	await fs.rm(baseDir, { recursive: true, force: true });
});

describe('computeArchiveCacheKey', () => {
	it('shapes the key as `<size>-<mtime_ns>-<ctime_ns>-<head>-<tail>` so callers can use it directly as a directory name component', async () => {
		const file = path.join(baseDir, 'a.nitpicker');
		await fs.writeFile(file, 'hello');
		const key = await computeArchiveCacheKey(file);
		// Three numeric segments (size + two timestamps) plus a 16-hex
		// head digest plus either a 16-hex tail digest or the literal
		// `short` for files smaller than the head+tail window.
		expect(key).toMatch(/^\d+-\d+-\d+-[\da-f]{16}-(?:[\da-f]{16}|short)$/);
	});

	it('rolls the key when the file contents are rewritten (mtime + ctime move)', async () => {
		const file = path.join(baseDir, 'b.nitpicker');
		await fs.writeFile(file, 'first');
		const key1 = await computeArchiveCacheKey(file);

		// fs.stat on APFS / ext4 has nanosecond resolution but a successive
		// write within the same tick can land on the same timestamp on some
		// runners. A 10ms gap guarantees a different mtime/ctime.
		await new Promise((resolve) => setTimeout(resolve, 10));
		await fs.writeFile(file, 'second-much-longer-to-also-bump-size');
		const key2 = await computeArchiveCacheKey(file);

		expect(key1).not.toBe(key2);
	});

	it('rolls the key when only inode metadata changes (`touch -m -t <past>` style)', async () => {
		// This closes the gap that `size + mtime` alone would leave open: if
		// a user resets mtime to a past value, ctime still bumps to "now"
		// because changing mtime is itself an inode metadata mutation. So
		// the key must change even when size and mtime are unchanged.
		const file = path.join(baseDir, 'c.nitpicker');
		await fs.writeFile(file, 'same content');
		const key1 = await computeArchiveCacheKey(file);

		// Set mtime back to an epoch in the past; ctime jumps to now.
		const past = new Date('2020-01-01T00:00:00Z');
		await fs.utimes(file, past, past);
		const key2 = await computeArchiveCacheKey(file);

		expect(key1).not.toBe(key2);
	});

	it('returns the same key when the file is read repeatedly without modification', async () => {
		const file = path.join(baseDir, 'd.nitpicker');
		await fs.writeFile(file, 'stable');
		const key1 = await computeArchiveCacheKey(file);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const key2 = await computeArchiveCacheKey(file);
		expect(key1).toBe(key2);
	});

	it('rejects when the path does not exist (no silent placeholder)', async () => {
		// We never want to return a deterministic-but-misleading key from
		// a non-existent file. Failing loudly here surfaces wiring bugs.
		const file = path.join(baseDir, 'never-existed.nitpicker');
		await expect(computeArchiveCacheKey(file)).rejects.toThrow();
	});
});
