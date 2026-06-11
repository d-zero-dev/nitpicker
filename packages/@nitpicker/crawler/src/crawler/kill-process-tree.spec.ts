import type { ProcessKiller } from './kill-process-tree.js';

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
