import { spawn } from 'node:child_process';

/**
 * Sends a signal to a single process.
 *
 * Abstracted from `process.kill` so tests can verify exactly which PIDs are
 * signalled without actually touching the OS.
 */
export interface ProcessKiller {
	/**
	 * Sends `signal` to the process with the given PID. Implementations should
	 * swallow ESRCH ("no such process") since the target may have already
	 * exited between enumeration and the kill call.
	 * @param pid - The PID to signal.
	 * @param signal - The signal name (e.g. `'SIGKILL'`) or number.
	 */
	kill(pid: number, signal: NodeJS.Signals | number): void;
}

/**
 * Dependency overrides for {@link killProcessTree}.
 *
 * Default implementations shell out to `ps` (POSIX) or `taskkill` (Windows),
 * which makes them awkward to unit-test directly. Injecting these lets tests
 * verify the orchestration without invoking real processes.
 */
export interface KillProcessTreeDeps {
	/**
	 * Lists the PIDs of every descendant of `rootPid` in BFS order
	 * (parents before children). Used only on POSIX.
	 */
	listDescendants?: (rootPid: number) => Promise<readonly number[]>;
	/** Signals a single PID. Used only on POSIX. */
	killer?: ProcessKiller;
	/**
	 * Performs an OS-level tree-kill. Used only on Windows, where `taskkill
	 * /T /F` handles the entire tree atomically.
	 */
	runTreeKill?: (rootPid: number) => Promise<void>;
	/** Override for `process.platform` so cross-platform paths can be tested. */
	platform?: NodeJS.Platform;
}

/**
 * Kills a process and every one of its descendants.
 *
 * WHY: After SIGKILL'ing Chromium's parent process, its renderer / network /
 * zygote subprocesses linger on Linux/macOS because puppeteer spawns Chromium
 * with `detached: false`, so we cannot use a process-group signal (a
 * negative-PID kill would also hit our own Node process). Enumerating
 * descendants via `ps -A -o pid=,ppid=` and signalling each one — leaves
 * first — closes the orphan gap. On Windows `taskkill /T /F /PID <pid>`
 * performs the equivalent OS-level tree kill atomically.
 *
 * Best-effort: ESRCH (process already gone) and `ps`/`taskkill` invocation
 * failures are swallowed, so the function never rejects on a partial-kill
 * outcome. The caller treats this as a hard cleanup that must always
 * resolve.
 * @param rootPid - The PID at the root of the tree.
 * @param signal - The signal to send. Defaults to `'SIGKILL'`. Ignored on
 *   Windows (`taskkill /F` is always forceful).
 * @param deps - Test-time overrides.
 */
export async function killProcessTree(
	rootPid: number,
	signal: NodeJS.Signals | number = 'SIGKILL',
	deps: KillProcessTreeDeps = {},
): Promise<void> {
	const platform = deps.platform ?? process.platform;

	if (platform === 'win32') {
		const runTreeKill = deps.runTreeKill ?? runWindowsTaskkill;
		await runTreeKill(rootPid);
		return;
	}

	const listDescendants = deps.listDescendants ?? listPosixDescendants;
	const killer = deps.killer ?? POSIX_DEFAULT_KILLER;

	const descendants = await listDescendants(rootPid);
	// BFS produces parents before children; reverse so leaves die first and
	// cannot re-spawn anything via their own watchdog before their parent goes.
	for (const pid of descendants.toReversed()) {
		killer.kill(pid, signal);
	}
	killer.kill(rootPid, signal);
}

/**
 * Default POSIX killer: `process.kill` with ESRCH/EPERM swallowed.
 *
 * Lives at module scope so it is shared across calls instead of being
 * re-allocated for every {@link killProcessTree} invocation.
 */
const POSIX_DEFAULT_KILLER: ProcessKiller = {
	kill(pid, signal) {
		try {
			process.kill(pid, signal);
		} catch {
			// Already dead (ESRCH) or denied (EPERM) — best-effort.
		}
	},
};

/**
 * Walks the process table on POSIX and returns every descendant of
 * `rootPid` in BFS order.
 *
 * Shells out to `ps -A -o pid=,ppid=` via `spawn` (no shell), parses each
 * row into `(pid, ppid)`, builds a parent-to-children map, then breadth-first
 * walks from `rootPid`.
 *
 * Failure to invoke `ps` (missing binary, permission denied, non-zero exit)
 * returns an empty array so the caller can still kill the root.
 * @param rootPid - The PID whose descendants to list.
 * @returns A promise resolving to descendant PIDs.
 */
async function listPosixDescendants(rootPid: number): Promise<readonly number[]> {
	const parentToChildren = await readPosixProcessMap();
	const descendants: number[] = [];
	const queue: number[] = [rootPid];
	while (queue.length > 0) {
		const pid = queue.shift()!;
		const children = parentToChildren.get(pid);
		if (!children) continue;
		for (const child of children) {
			descendants.push(child);
			queue.push(child);
		}
	}
	return descendants;
}

/**
 * Reads the full POSIX process table by spawning `ps` and parsing its output.
 *
 * Format requested: `pid=,ppid=` (no headers). Each line is `<pid> <ppid>`.
 * @returns A promise resolving to a parent-PID-to-children map. Empty on
 *   any invocation failure.
 */
async function readPosixProcessMap(): Promise<ReadonlyMap<number, readonly number[]>> {
	return new Promise((resolve) => {
		const proc = spawn('ps', ['-A', '-o', 'pid=,ppid='], {
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		let output = '';
		proc.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString('utf8');
		});
		proc.on('error', () => resolve(new Map()));
		proc.on('close', (code) => {
			if (code !== 0) {
				resolve(new Map());
				return;
			}
			const map = new Map<number, number[]>();
			for (const line of output.split('\n')) {
				const match = /^\s*(\d+)\s+(\d+)/.exec(line);
				if (!match) continue;
				const pid = Number(match[1]);
				const ppid = Number(match[2]);
				const list = map.get(ppid);
				if (list) {
					list.push(pid);
				} else {
					map.set(ppid, [pid]);
				}
			}
			resolve(map);
		});
	});
}

/**
 * Forces a tree-kill on Windows via `taskkill /T /F /PID <pid>`.
 *
 * The `/T` flag walks descendants; `/F` forces termination. Any failure
 * (ENOENT for taskkill, non-zero exit because the PID is already gone) is
 * swallowed.
 * @param rootPid - The PID at the root of the tree.
 */
async function runWindowsTaskkill(rootPid: number): Promise<void> {
	return new Promise<void>((resolve) => {
		const proc = spawn('taskkill', ['/T', '/F', '/PID', String(rootPid)], {
			stdio: 'ignore',
		});
		proc.on('error', () => resolve());
		proc.on('close', () => resolve());
	});
}
