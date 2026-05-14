import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Lock failure surfaced when an archive's tmpDir is already in use by another
 * live process.
 *
 * The lock path and PID of the holder are exposed so callers (CLI / orchestrator)
 * can render a precise error message and let operators recover manually.
 */
export class ArchiveLockError extends Error {
	/** PID of the live process currently holding the lock, or `null` if unknown. */
	readonly holderPid: number | null;
	/** The lock directory path that could not be acquired. */
	readonly lockPath: string;

	/**
	 * @param lockPath - Absolute path of the lock directory.
	 * @param holderPid - PID stored in the lock's `pid.txt`, or `null` if unreadable.
	 */
	constructor(lockPath: string, holderPid: number | null) {
		const suffix = holderPid === null ? '' : ` (PID ${holderPid})`;
		super(`Archive is being used by another process${suffix}: ${lockPath}`);
		this.name = 'ArchiveLockError';
		this.lockPath = lockPath;
		this.holderPid = holderPid;
	}
}

/**
 * Acquire an advisory lock on the given tmpDir.
 *
 * Uses `fs.mkdir(lockPath, { recursive: false })` as the atomic primitive so
 * that two concurrent processes targeting the same archive cannot both believe
 * they own it. The lock is published as a sibling directory named
 * `{tmpDir}.lock` containing a `pid.txt` file with the holder's PID.
 *
 * On `EEXIST` the function tries once to detect a stale lock: if the recorded
 * PID is not alive any more (`process.kill(pid, 0)` throws `ESRCH`), the stale
 * directory is removed and a single retry is issued. If acquisition still
 * fails — or the holder is alive — an {@link ArchiveLockError} is thrown.
 *
 * The returned function releases the lock; it is idempotent so callers can put
 * it in a `finally` block without worrying about double-release.
 * @param tmpDir - Absolute path to the archive's temporary working directory.
 * @returns A release function to be called when the work is done.
 * @throws {ArchiveLockError} When the lock cannot be acquired even after a stale-lock retry.
 */
export async function acquireArchiveLock(tmpDir: string): Promise<() => Promise<void>> {
	const lockPath = `${tmpDir}.lock`;
	await tryAcquire(lockPath);
	let released = false;
	return async () => {
		if (released) {
			return;
		}
		released = true;
		await releaseLock(lockPath);
	};
}

/**
 * Attempt to create the lock directory and write the holder PID, handling one
 * round of stale-lock recovery.
 * @param lockPath - The absolute lock directory path.
 */
async function tryAcquire(lockPath: string): Promise<void> {
	try {
		await fs.mkdir(lockPath, { recursive: false });
		await fs.writeFile(path.join(lockPath, 'pid.txt'), String(process.pid), 'utf8');
		return;
	} catch (error) {
		if (!isEexist(error)) {
			throw error;
		}
	}

	const holderPid = await readHolderPid(lockPath);
	if (holderPid !== null && isProcessAlive(holderPid)) {
		throw new ArchiveLockError(lockPath, holderPid);
	}

	// Stale lock — clean up and retry once. A concurrent acquirer may have
	// already reclaimed the directory, so a second EEXIST is treated as a real
	// collision and surfaced to the caller.
	await fs.rm(lockPath, { recursive: true, force: true });
	try {
		await fs.mkdir(lockPath, { recursive: false });
		await fs.writeFile(path.join(lockPath, 'pid.txt'), String(process.pid), 'utf8');
	} catch (error) {
		if (isEexist(error)) {
			const pid = await readHolderPid(lockPath);
			throw new ArchiveLockError(lockPath, pid);
		}
		throw error;
	}
}

/**
 * Remove the lock directory. Errors are ignored so a `finally`-style call site
 * is safe even when the directory was already cleaned up externally.
 * @param lockPath - The absolute lock directory path.
 */
async function releaseLock(lockPath: string): Promise<void> {
	await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
}

/**
 * Read the PID stored in the lock directory's `pid.txt`.
 * @param lockPath - The absolute lock directory path.
 * @returns The parsed PID, or `null` if the file is missing or malformed.
 */
async function readHolderPid(lockPath: string): Promise<number | null> {
	try {
		const raw = await fs.readFile(path.join(lockPath, 'pid.txt'), 'utf8');
		const pid = Number.parseInt(raw.trim(), 10);
		return Number.isFinite(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/**
 * Check whether the given PID is still alive using a signal-0 probe.
 * @param pid - The process id to probe.
 * @returns `true` if the process exists (regardless of permission).
 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but is owned by another user — still alive.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/**
 * Type-guard for an `EEXIST` filesystem error.
 * @param error - The error value to inspect.
 * @returns `true` when the error is a Node `EEXIST` from a filesystem call.
 */
function isEexist(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}
