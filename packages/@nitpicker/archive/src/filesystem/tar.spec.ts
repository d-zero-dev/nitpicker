import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tar } from './tar.js';
import { untar } from './untar.js';

describe('tar', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-tar');
	const srcDir = path.join(testDir, 'source');
	const extractDir = path.join(testDir, 'extract');

	beforeEach(() => {
		mkdirSync(srcDir, { recursive: true });
		mkdirSync(extractDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('creates and extracts a tar archive', async () => {
		writeFileSync(path.join(srcDir, 'test.txt'), 'hello tar');
		const tarPath = path.join(testDir, 'archive.tar');
		await tar(srcDir, tarPath);
		expect(existsSync(tarPath)).toBe(true);

		await untar(tarPath, { cwd: extractDir });
		expect(existsSync(path.join(extractDir, 'source', 'test.txt'))).toBe(true);
	});

	it('reports written-byte progress against the estimated total when onProgress is given (issue #294)', async () => {
		writeFileSync(path.join(srcDir, 'big.txt'), 'a'.repeat(100_000));
		const tarPath = path.join(testDir, 'archive.tar');

		const calls: [number, number][] = [];
		await tar(srcDir, tarPath, (writtenBytes, totalBytes) => {
			calls.push([writtenBytes, totalBytes]);
		});

		expect(calls.length).toBeGreaterThan(0);
		const totalBytes = calls[0]![1];
		expect(totalBytes).toBe(100_000);
		for (const [writtenBytes, total] of calls) {
			expect(total).toBe(totalBytes);
			expect(writtenBytes).toBeLessThanOrEqual(totalBytes);
		}
		// Monotonic: byte counts never go backwards.
		for (let i = 1; i < calls.length; i++) {
			expect(calls[i]![0]).toBeGreaterThanOrEqual(calls[i - 1]![0]);
		}
		// The final callback marks completion at exactly the estimated total.
		expect(calls.at(-1)![0]).toBe(totalBytes);

		// And the produced archive still round-trips.
		await untar(tarPath, { cwd: extractDir });
		expect(existsSync(path.join(extractDir, 'source', 'big.txt'))).toBe(true);
	});

	it('rejects (without hanging) when the sink stream errors mid-write (issue #294 code review)', async () => {
		// A write target inside a non-existent parent directory fails to open
		// (ENOENT) on the sink side — a real, deterministic sink-side stream
		// error exercising the `sink.on('error', ...) -> source.destroy()`
		// path (only taken when `onProgress` is given, which forces the
		// manual-stream branch instead of tar's own `file` mode).
		writeFileSync(path.join(srcDir, 'test.txt'), 'hello tar');
		const badOutputPath = path.join(testDir, 'no-such-dir', 'archive.tar');

		await expect(
			tar(srcDir, badOutputPath, () => {
				// no-op: only the rejection matters here
			}),
		).rejects.toThrow();
	});
});
