import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireArchiveLock, ArchiveLockError } from './archive-lock.js';

const baseDir = path.resolve(os.tmpdir(), 'nitpicker-archive-lock-test');

beforeEach(async () => {
	await fs.mkdir(baseDir, { recursive: true });
});

afterEach(async () => {
	await fs.rm(baseDir, { recursive: true, force: true });
});

/**
 * Create a unique tmpDir path under the test base directory. The directory
 * itself is not created — `acquireArchiveLock` operates on `tmpDir + ".lock"`,
 * which it creates atomically.
 * @param suffix - Suffix appended to the tmpDir name for test isolation.
 * @returns Absolute tmpDir path.
 */
function makeTmpDir(suffix: string): string {
	return path.join(baseDir, `tmp-${suffix}-${Date.now()}-${Math.random()}`);
}

describe('acquireArchiveLock', () => {
	it('acquires the lock when no other process holds it', async () => {
		const tmpDir = makeTmpDir('acquire');
		const release = await acquireArchiveLock(tmpDir);

		const stat = await fs.stat(`${tmpDir}.lock`);
		expect(stat.isDirectory()).toBe(true);

		await release();
		await expect(fs.stat(`${tmpDir}.lock`)).rejects.toThrow();
	});

	it('records the holder pid in pid.txt', async () => {
		const tmpDir = makeTmpDir('pid');
		const release = await acquireArchiveLock(tmpDir);

		const raw = await fs.readFile(path.join(`${tmpDir}.lock`, 'pid.txt'), 'utf8');
		expect(Number.parseInt(raw, 10)).toBe(process.pid);

		await release();
	});

	it('throws ArchiveLockError when the holder is alive', async () => {
		const tmpDir = makeTmpDir('alive');
		const release = await acquireArchiveLock(tmpDir);

		await expect(acquireArchiveLock(tmpDir)).rejects.toBeInstanceOf(ArchiveLockError);

		await release();
	});

	it('recovers a stale lock whose pid no longer exists', async () => {
		const tmpDir = makeTmpDir('stale');
		const lockPath = `${tmpDir}.lock`;

		// Plant a stale lock pointing at a definitely-not-running pid.
		// PIDs above 2^22 are guaranteed not to exist on Linux/macOS.
		await fs.mkdir(lockPath, { recursive: true });
		await fs.writeFile(path.join(lockPath, 'pid.txt'), '9999999', 'utf8');

		const release = await acquireArchiveLock(tmpDir);
		const raw = await fs.readFile(path.join(lockPath, 'pid.txt'), 'utf8');
		expect(Number.parseInt(raw, 10)).toBe(process.pid);

		await release();
	});

	it('release is idempotent — calling twice does not throw', async () => {
		const tmpDir = makeTmpDir('idempotent');
		const release = await acquireArchiveLock(tmpDir);

		await release();
		await expect(release()).resolves.toBeUndefined();
	});

	it('release tolerates an already-removed lock directory', async () => {
		const tmpDir = makeTmpDir('manual-cleanup');
		const release = await acquireArchiveLock(tmpDir);

		// Simulate external cleanup
		await fs.rm(`${tmpDir}.lock`, { recursive: true, force: true });

		await expect(release()).resolves.toBeUndefined();
	});
});
