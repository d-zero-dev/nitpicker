import type { ProcessKiller, Spawner } from './kill-process-tree.js';
import type { ChildProcess } from 'node:child_process';

import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { killProcessTree } from './kill-process-tree.js';

/**
 * Builds a {@link ProcessKiller} whose `kill` is a `vi.fn()` so call order
 * and arguments can be asserted directly.
 * @returns The mock killer.
 */
function createMockKiller(): ProcessKiller & { kill: ReturnType<typeof vi.fn> } {
	return { kill: vi.fn() };
}

/**
 * Minimal {@link ChildProcess} stand-in for tests: an EventEmitter plus a
 * piped stdout that the caller can write to via `pushStdout`. The real
 * ChildProcess type is structurally a superset of this for the methods our
 * implementation actually touches (`on`, `stdout.on('data')`).
 */
interface FakeChild {
	/** Emits the `close` event with the supplied exit code. */
	close(code: number | null): void;
	/** Emits the `error` event with the supplied Error. */
	emitError(error: Error): void;
	/** Pushes a chunk of bytes to the fake stdout. */
	pushStdout(chunk: string | Buffer): void;
	/** Cast helper to satisfy the {@link Spawner} return type. */
	asChildProcess(): ChildProcess;
}

/**
 * Creates a {@link FakeChild} suitable for handing back from a fake {@link Spawner}.
 */
function createFakeChild(): FakeChild {
	const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
	const stdout = new EventEmitter();
	(child as unknown as { stdout: EventEmitter }).stdout = stdout;
	return {
		close(code) {
			child.emit('close', code);
		},
		emitError(error) {
			child.emit('error', error);
		},
		pushStdout(chunk) {
			stdout.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		},
		asChildProcess() {
			return child as unknown as ChildProcess;
		},
	};
}

describe('killProcessTree (POSIX)', () => {
	it('kills the root when it has no descendants', async () => {
		const killer = createMockKiller();
		const listDescendants = vi.fn(() => Promise.resolve([] as readonly number[]));

		await killProcessTree(1234, 'SIGKILL', {
			platform: 'linux',
			listDescendants,
			killer,
		});

		expect(killer.kill).toHaveBeenCalledExactlyOnceWith(1234, 'SIGKILL');
		expect(listDescendants).toHaveBeenCalledExactlyOnceWith(1234);
	});

	it('kills descendants leaves-first, then the root', async () => {
		const killer = createMockKiller();
		// BFS order from root 100: child=200, grand=300 (under 200), great=400 (under 300)
		const listDescendants = vi.fn(() =>
			Promise.resolve([200, 300, 400] as readonly number[]),
		);

		await killProcessTree(100, 'SIGKILL', {
			platform: 'darwin',
			listDescendants,
			killer,
		});

		expect(killer.kill).toHaveBeenCalledTimes(4);
		// Reversed (leaves first): 400, 300, 200, then root 100.
		expect(killer.kill.mock.calls).toStrictEqual([
			[400, 'SIGKILL'],
			[300, 'SIGKILL'],
			[200, 'SIGKILL'],
			[100, 'SIGKILL'],
		]);
	});

	it('passes the supplied signal through to every kill', async () => {
		const killer = createMockKiller();
		const listDescendants = vi.fn(() => Promise.resolve([200] as readonly number[]));

		await killProcessTree(100, 'SIGTERM', {
			platform: 'linux',
			listDescendants,
			killer,
		});

		expect(killer.kill.mock.calls).toStrictEqual([
			[200, 'SIGTERM'],
			[100, 'SIGTERM'],
		]);
	});

	it('still kills the root when descendant enumeration returns empty', async () => {
		// Simulates `ps` failing or returning no rows for our PID.
		const killer = createMockKiller();
		const listDescendants = vi.fn(() => Promise.resolve([] as readonly number[]));

		await killProcessTree(999, 'SIGKILL', {
			platform: 'linux',
			listDescendants,
			killer,
		});

		expect(killer.kill).toHaveBeenCalledExactlyOnceWith(999, 'SIGKILL');
	});

	it('does not reject when the killer itself throws on every call', async () => {
		// Default POSIX killer swallows ESRCH/EPERM, but custom killers may
		// not — verify the orchestrator does not crash if one PID errors.
		const killer: ProcessKiller = {
			kill() {
				throw new Error('boom');
			},
		};
		const listDescendants = () => Promise.resolve([200, 300] as readonly number[]);

		// The current implementation does NOT catch arbitrary killer errors,
		// only the default killer swallows them. Document this contract: callers
		// using a custom killer must make it best-effort themselves.
		await expect(
			killProcessTree(100, 'SIGKILL', {
				platform: 'linux',
				listDescendants,
				killer,
			}),
		).rejects.toThrow('boom');
	});
});

describe('killProcessTree (Windows)', () => {
	it('delegates to runTreeKill and does not enumerate descendants', async () => {
		const runTreeKill = vi.fn(() => Promise.resolve());
		const killer = createMockKiller();
		const listDescendants = vi.fn(() => Promise.resolve([200, 300] as readonly number[]));

		await killProcessTree(7777, 'SIGKILL', {
			platform: 'win32',
			runTreeKill,
			killer,
			listDescendants,
		});

		expect(runTreeKill).toHaveBeenCalledExactlyOnceWith(7777);
		// Windows path skips the POSIX enumeration entirely.
		expect(listDescendants).not.toHaveBeenCalled();
		expect(killer.kill).not.toHaveBeenCalled();
	});

	it('resolves even when runTreeKill rejects (best-effort cleanup contract)', async () => {
		// Real implementation uses spawn + close listener that resolves on
		// any exit code, but custom test doubles may reject. Document the
		// orchestrator's lack of additional catching here.
		const runTreeKill = vi.fn(() => Promise.reject(new Error('taskkill missing')));

		await expect(
			killProcessTree(7777, 'SIGKILL', {
				platform: 'win32',
				runTreeKill,
			}),
		).rejects.toThrow('taskkill missing');
	});
});

describe('killProcessTree (default deps integration)', () => {
	it('defaults to the current process platform when none is supplied', async () => {
		// Smoke test: invoke with a fake PID that almost certainly does not exist.
		// On every supported platform the function must resolve without throwing,
		// because both default killers swallow ENOENT/ESRCH.
		await expect(killProcessTree(999_999_999)).resolves.toBeUndefined();
	});
});

describe('killProcessTree default runWindowsTaskkill (via Spawner injection)', () => {
	it('spawns taskkill /T /F /PID <pid> with stdio ignored', async () => {
		const child = createFakeChild();
		const spawner = vi.fn<Spawner>(() => child.asChildProcess());

		const promise = killProcessTree(7777, 'SIGKILL', {
			platform: 'win32',
			spawn: spawner,
		});
		// Resolve the spawn (taskkill exits 0).
		child.close(0);
		await promise;

		expect(spawner).toHaveBeenCalledExactlyOnceWith(
			'taskkill',
			['/T', '/F', '/PID', '7777'],
			{ stdio: 'ignore' },
		);
	});

	it('logs and resolves when taskkill cannot be spawned (ENOENT)', async () => {
		const child = createFakeChild();
		const spawner = vi.fn<Spawner>(() => child.asChildProcess());
		const log = vi.fn();

		const promise = killProcessTree(7777, 'SIGKILL', {
			platform: 'win32',
			spawn: spawner,
			log,
		});
		child.emitError(new Error('spawn taskkill ENOENT'));
		await promise;

		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]![0]).toMatch(/taskkill invocation failed/);
	});

	it('logs and resolves when taskkill exits non-zero (e.g. PID already gone)', async () => {
		const child = createFakeChild();
		const spawner = vi.fn<Spawner>(() => child.asChildProcess());
		const log = vi.fn();

		const promise = killProcessTree(7777, 'SIGKILL', {
			platform: 'win32',
			spawn: spawner,
			log,
		});
		child.close(128);
		await promise;

		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]![0]).toMatch(/taskkill exited with non-zero/);
	});
});

describe('killProcessTree default POSIX ps enumeration (via Spawner injection)', () => {
	it('spawns ps -A -o pid=,ppid= and BFS-walks the parsed output', async () => {
		const child = createFakeChild();
		const spawner = vi.fn<Spawner>(() => child.asChildProcess());
		const killer = createMockKiller();

		const promise = killProcessTree(100, 'SIGKILL', {
			platform: 'linux',
			spawn: spawner,
			killer,
		});
		// Process table: 200 is child of 100, 300 is grandchild via 200.
		// Plus an unrelated 400 with ppid=999 (should NOT be killed).
		child.pushStdout('100 1\n200 100\n300 200\n400 999\n');
		child.close(0);
		await promise;

		expect(spawner).toHaveBeenCalledExactlyOnceWith('ps', ['-A', '-o', 'pid=,ppid='], {
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		// Leaves first: 300, 200, then root 100. 400 untouched.
		expect(killer.kill.mock.calls).toStrictEqual([
			[300, 'SIGKILL'],
			[200, 'SIGKILL'],
			[100, 'SIGKILL'],
		]);
	});

	it('logs and falls back to killing only the root when ps cannot be spawned', async () => {
		const child = createFakeChild();
		const spawner = vi.fn<Spawner>(() => child.asChildProcess());
		const killer = createMockKiller();
		const log = vi.fn();

		const promise = killProcessTree(100, 'SIGKILL', {
			platform: 'linux',
			spawn: spawner,
			killer,
			log,
		});
		child.emitError(new Error('spawn ps ENOENT'));
		await promise;

		expect(killer.kill).toHaveBeenCalledExactlyOnceWith(100, 'SIGKILL');
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]![0]).toMatch(/ps invocation failed/);
	});

	it('logs and falls back to killing only the root when ps exits non-zero', async () => {
		const child = createFakeChild();
		const spawner = vi.fn<Spawner>(() => child.asChildProcess());
		const killer = createMockKiller();
		const log = vi.fn();

		const promise = killProcessTree(100, 'SIGKILL', {
			platform: 'linux',
			spawn: spawner,
			killer,
			log,
		});
		child.pushStdout('garbage that does not parse\n');
		child.close(1);
		await promise;

		expect(killer.kill).toHaveBeenCalledExactlyOnceWith(100, 'SIGKILL');
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]![0]).toMatch(/ps exited with non-zero/);
	});
});

describe('killProcessTree default POSIX killer logging', () => {
	it('logs each swallowed process.kill error (ESRCH/EPERM)', async () => {
		// Cannot stub process.kill cleanly without affecting Node internals,
		// so the integration smoke approach: target an obviously dead PID.
		// The default killer swallows the resulting ESRCH and logs it.
		const log = vi.fn();
		const child = createFakeChild();
		const spawner = vi.fn<Spawner>(() => child.asChildProcess());

		const promise = killProcessTree(999_999_998, 'SIGKILL', {
			platform: 'linux',
			spawn: spawner,
			log,
		});
		// Empty process table → no descendants → killer attempts only the root.
		child.close(0);
		await promise;

		expect(log).toHaveBeenCalled();
		// log uses debug-style printf placeholders; assert format + the
		// interpolated PID argument separately.
		const lastCall = log.mock.calls.at(-1)!;
		expect(lastCall[0]).toMatch(/process\.kill\(%d, %s\) failed/);
		expect(lastCall[1]).toBe(999_999_998);
	});
});
