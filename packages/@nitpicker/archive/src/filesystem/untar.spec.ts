import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tar } from './tar.js';
import { untar } from './untar.js';

describe('untar', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-untar');
	const srcDir = path.join(testDir, 'source');
	const extractDir = path.join(testDir, 'extract');

	beforeEach(() => {
		mkdirSync(srcDir, { recursive: true });
		mkdirSync(extractDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('extracts specific files from tar archive', async () => {
		writeFileSync(path.join(srcDir, 'a.txt'), 'aaa');
		writeFileSync(path.join(srcDir, 'b.txt'), 'bbb');
		const tarPath = path.join(testDir, 'archive.tar');
		await tar(srcDir, tarPath);

		await untar(tarPath, { cwd: extractDir, fileList: ['source/a.txt'] });
		expect(existsSync(path.join(extractDir, 'source', 'a.txt'))).toBe(true);
		expect(readFileSync(path.join(extractDir, 'source', 'a.txt'), 'utf8')).toBe('aaa');
	});

	it('reports byte progress against the archive total when onProgress is given (issue #294)', async () => {
		writeFileSync(path.join(srcDir, 'a.txt'), 'a'.repeat(100_000));
		const tarPath = path.join(testDir, 'archive.tar');
		await tar(srcDir, tarPath);

		const calls: [number, number][] = [];
		await untar(tarPath, {
			cwd: extractDir,
			onProgress: (readBytes, totalBytes) => {
				calls.push([readBytes, totalBytes]);
			},
		});

		expect(calls.length).toBeGreaterThan(0);
		const tarSize = calls[0]![1];
		expect(tarSize).toBeGreaterThan(100_000);
		for (const [readBytes, totalBytes] of calls) {
			expect(totalBytes).toBe(tarSize);
			expect(readBytes).toBeGreaterThan(0);
			expect(readBytes).toBeLessThanOrEqual(tarSize);
		}
		// Monotonic: byte counts never go backwards.
		for (let i = 1; i < calls.length; i++) {
			expect(calls[i]![0]).toBeGreaterThanOrEqual(calls[i - 1]![0]);
		}
		// The final callback accounts for the whole archive being consumed.
		expect(calls.at(-1)![0]).toBe(tarSize);
		// And the extraction itself still completed.
		expect(existsSync(path.join(extractDir, 'source', 'a.txt'))).toBe(true);
	});

	it('rejects (without hanging) when the source stream errors mid-read (issue #294 code review)', async () => {
		// `createReadStream` on a directory opens successfully but fails with
		// EISDIR on the first read, giving a real, deterministic source-side
		// stream error without corrupting a real tar file — exercises the
		// `source.on('error', ...) -> destroyableSink.destroy()` path.
		await expect(
			untar(srcDir, {
				cwd: extractDir,
				onProgress: () => {
					// no-op: only the rejection matters here
				},
			}),
		).rejects.toThrow();
	});
});
