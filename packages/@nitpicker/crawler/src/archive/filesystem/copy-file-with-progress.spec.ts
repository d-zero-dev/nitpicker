import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyFileWithProgress } from './copy-file-with-progress.js';

describe('copyFileWithProgress', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-copy-file-with-progress');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('copies the file content byte-for-byte', async () => {
		const src = path.join(testDir, 'src.bin');
		const dest = path.join(testDir, 'dest.bin');
		writeFileSync(src, 'a'.repeat(100_000));

		await copyFileWithProgress(src, dest);

		expect(readFileSync(dest, 'utf8')).toBe('a'.repeat(100_000));
	});

	it('copies correctly when onProgress is omitted', async () => {
		const src = path.join(testDir, 'src.bin');
		const dest = path.join(testDir, 'dest.bin');
		writeFileSync(src, 'silent-copy');

		await copyFileWithProgress(src, dest);

		expect(readFileSync(dest, 'utf8')).toBe('silent-copy');
	});

	it('reports monotonic byte progress against the source total (issue #294)', async () => {
		const src = path.join(testDir, 'src.bin');
		const dest = path.join(testDir, 'dest.bin');
		writeFileSync(src, 'a'.repeat(100_000));

		const calls: [number, number][] = [];
		await copyFileWithProgress(src, dest, (copiedBytes, totalBytes) => {
			calls.push([copiedBytes, totalBytes]);
		});

		expect(calls.length).toBeGreaterThan(0);
		for (const [copiedBytes, totalBytes] of calls) {
			expect(totalBytes).toBe(100_000);
			expect(copiedBytes).toBeGreaterThan(0);
			expect(copiedBytes).toBeLessThanOrEqual(100_000);
		}
		for (let i = 1; i < calls.length; i++) {
			expect(calls[i]![0]).toBeGreaterThanOrEqual(calls[i - 1]![0]);
		}
		expect(calls.at(-1)![0]).toBe(100_000);
	});

	it('rejects when the source does not exist', async () => {
		await expect(
			copyFileWithProgress(path.join(testDir, 'missing.bin'), path.join(testDir, 'x')),
		).rejects.toThrow();
	});

	it('overwrites an existing destination file', async () => {
		const src = path.join(testDir, 'src.bin');
		const dest = path.join(testDir, 'dest.bin');
		writeFileSync(src, 'new-content');
		writeFileSync(dest, 'stale-content-that-is-longer-than-new');

		await copyFileWithProgress(src, dest);

		expect(readFileSync(dest, 'utf8')).toBe('new-content');
	});
});
