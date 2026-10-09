import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Result of probing an archive's `.lock` sibling without acquiring it.
 *
 * Used by read-only consumers (the viewer, MCP `open_archive`) that want
 * to surface "a crawler is currently writing this archive" to the user
 * without blocking or competing for the lock.
 */
export interface ArchiveLockHolder {
	/** Path of the lock directory (`<tmpDir>.lock`) that was probed. */
	readonly lockPath: string;
	/** PID of the process whose lock is recorded in `pid.txt`. */
	readonly pid: number;
	/**
	 * Whether that PID is currently alive on the OS (signal-0 probe).
	 *
	 * **PID-recycling caveat**: this only proves *some* process owns that PID,
	 * not necessarily the original crawler. Callers should treat
	 * `{ alive: true }` as "likely a live crawler" rather than a hard
	 * guarantee.
	 */
	readonly alive: boolean;
}

/**
 * Probe `<tmpDir>.lock/pid.txt` without acquiring the lock.
 *
 * Mirror of the alive-check inside `acquireArchiveLock`, exposed for
 * read-only consumers so they can detect (and surface) a concurrent crawler
 * without competing for the lock. Returns `null` when no lock directory is
 * present or the pid file is missing/malformed — callers should treat that
 * as "no detectable crawler" rather than as an error.
 *
 * Co-located with `acquireArchiveLock` so the writer side and the
 * read-only probe stay in lockstep when the lock format evolves (e.g.
 * adding a hostname/timestamp field).
 * @param tmpDir - The archive's temporary working directory whose
 *   `${tmpDir}.lock` sibling will be probed.
 * @returns Lock-holder metadata when a parseable lock exists, otherwise
 *   `null`.
 */
export function peekArchiveLockHolder(tmpDir: string): ArchiveLockHolder | null {
	const lockPath = `${tmpDir}.lock`;
	if (!existsSync(lockPath)) {
		return null;
	}
	const pid = readPidFile(lockPath);
	if (pid === null) {
		return null;
	}
	return { lockPath, pid, alive: isProcessAlive(pid) };
}

/**
 * Read the PID stored in the lock's `pid.txt`. Returns `null` for any
 * missing/unparsable/non-positive content so the probe degrades gracefully
 * on partially-written or corrupted lock dirs.
 * @param lockPath - The lock directory path.
 */
function readPidFile(lockPath: string): number | null {
	try {
		const raw = readFileSync(path.join(lockPath, 'pid.txt'), 'utf8');
		const pid = Number.parseInt(raw.trim(), 10);
		return Number.isFinite(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/**
 * Check whether a PID is currently alive using a signal-0 probe.
 *
 * Treats `EPERM` as alive (the process exists but is owned by another
 * user). Any other errno (notably `ESRCH`) means dead.
 * @param pid - The process id to probe.
 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}
