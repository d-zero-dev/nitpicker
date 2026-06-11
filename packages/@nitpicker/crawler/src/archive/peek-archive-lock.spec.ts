import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { peekArchiveLockHolder } from './peek-archive-lock.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(__dirname, '__test_fixtures_peek_archive_lock__');

/**
 * Convenience: write a lock dir alongside `tmpDir` with the given pid
 * payload (pass `null` to skip writing pid.txt, mimicking a partially-
 * written lock).
 * @param tmpDir
 * @param pid
 */
function writeLock(tmpDir: string, pid: string | null) {
	const lockPath = `${tmpDir}.lock`;
	mkdirSync(lockPath, { recursive: true });
	if (pid !== null) {
		writeFileSync(path.join(lockPath, 'pid.txt'), pid, 'utf8');
	}
	return lockPath;
}

describe('peekArchiveLockHolder', () => {
	beforeAll(() => {
		mkdirSync(workingDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lock 親ディレクトリが存在しない場合は null を返す（probe は安全に no-op で degrade）', () => {
		const tmpDir = path.resolve(workingDir, 'no-lock');
		// No `${tmpDir}.lock` directory at all.
		expect(peekArchiveLockHolder(tmpDir)).toBeNull();
	});

	it('lock 親ディレクトリは存在するが pid.txt が無いと null を返す（partially-written lock を安全に扱う）', () => {
		const tmpDir = path.resolve(workingDir, 'lock-missing-pid');
		writeLock(tmpDir, null);
		try {
			expect(peekArchiveLockHolder(tmpDir)).toBeNull();
		} finally {
			rmSync(`${tmpDir}.lock`, { recursive: true, force: true });
		}
	});

	it('pid.txt が現プロセス PID を含むと alive=true を返す（リアルな alive 経路）', () => {
		const tmpDir = path.resolve(workingDir, 'lock-alive');
		const lockPath = writeLock(tmpDir, String(process.pid));
		try {
			expect(peekArchiveLockHolder(tmpDir)).toEqual({
				lockPath,
				pid: process.pid,
				alive: true,
			});
		} finally {
			rmSync(lockPath, { recursive: true, force: true });
		}
	});

	it('pid.txt が確実に存在しない PID を含むと alive=false を返す（PID リサイクル境界）', () => {
		const tmpDir = path.resolve(workingDir, 'lock-dead');
		// 0x7FFFFFFF — kernel-reserved/unreachable on POSIX, will yield ESRCH.
		const lockPath = writeLock(tmpDir, '2147483646');
		try {
			const holder = peekArchiveLockHolder(tmpDir);
			expect(holder).not.toBeNull();
			expect(holder?.pid).toBe(2_147_483_646);
			expect(holder?.alive).toBe(false);
		} finally {
			rmSync(lockPath, { recursive: true, force: true });
		}
	});

	it('pid.txt の中身が malformed なら null を返す（空文字／非数値／負数／0／無限大）', () => {
		// '1.5' is intentionally NOT in this list: `parseInt(..., 10)` truncates
		// fractional content to `1`, which the helper treats as a valid PID
		// (matches the writer-side `archive-lock.ts` parsing behavior — we
		// must stay consistent with what the crawler actually writes).
		const cases = ['', '   ', 'abc', '-1', '0', 'NaN', 'Infinity'];
		for (const [i, raw] of cases.entries()) {
			const tmpDir = path.resolve(workingDir, `lock-malformed-${i}`);
			const lockPath = writeLock(tmpDir, raw);
			try {
				expect(peekArchiveLockHolder(tmpDir)).toBeNull();
			} finally {
				rmSync(lockPath, { recursive: true, force: true });
			}
		}
	});

	it('pid.txt 前後の空白は trim される', () => {
		const tmpDir = path.resolve(workingDir, 'lock-with-whitespace');
		const lockPath = writeLock(tmpDir, `  ${String(process.pid)}  \n`);
		try {
			const holder = peekArchiveLockHolder(tmpDir);
			expect(holder?.pid).toBe(process.pid);
			expect(holder?.alive).toBe(true);
		} finally {
			rmSync(lockPath, { recursive: true, force: true });
		}
	});
});
