import net from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { findFreePort } from './find-free-port.js';

/**
 * Installs a fake `net.Server` (via spying on `net.createServer`) that records
 * every `listen(...)` argument list and reports success immediately.
 *
 * This lets a test assert *which interface the port is probed on* — the crux of
 * the IPv4/IPv6 fix — without depending on real IPv6 (`::1`) availability, which
 * is flaky in CI.
 * @returns The recorded `listen` argument lists and a `restore` function.
 */
function spyOnListen(): {
	/** Captured argument lists, one per `listen()` call. */
	calls: unknown[][];
	/** Restores the original `net.createServer`. */
	restore: () => void;
} {
	const calls: unknown[][] = [];
	const fakeServer = {
		unref() {},
		once() {
			return this;
		},
		address() {
			return { port: 51_234 } as net.AddressInfo;
		},
		close(callback?: () => void) {
			callback?.();
		},
		listen(...args: unknown[]) {
			calls.push(args);
			const callback = args.at(-1);
			if (typeof callback === 'function') {
				callback();
			}
			return this;
		},
	};
	const spy = vi
		.spyOn(net, 'createServer')
		.mockReturnValue(fakeServer as unknown as net.Server);
	return { calls, restore: () => spy.mockRestore() };
}

describe('findFreePort', () => {
	let occupied: net.Server | undefined;

	afterEach(() => {
		occupied?.close();
		occupied = undefined;
	});

	it('空きポート(0 指定)で正のポート番号を返す', async () => {
		const port = await findFreePort(0);
		expect(port).toBeGreaterThan(0);
	});

	it('使用中ポートが指定された場合は別のポートにフォールバックする', async () => {
		const server = net.createServer();
		await new Promise<void>((resolve) => {
			server.listen(0, () => {
				resolve();
			});
		});
		occupied = server;
		const address = server.address();
		const inUse = typeof address === 'object' && address ? address.port : 0;

		const port = await findFreePort(inUse);
		expect(port).toBeGreaterThan(0);
		expect(port).not.toBe(inUse);
	});

	it('host を渡すと listen に host を転送する（probe 先を serve と一致させる）', async () => {
		// The IPv4/IPv6 fix hinges on probing the *same* interface the server
		// binds. Asserting the host reaches `listen` proves that wiring directly
		// and deterministically (a real ::1 probe would be CI-flaky).
		const { calls, restore } = spyOnListen();
		try {
			await findFreePort(4324, 'localhost');
		} finally {
			restore();
		}
		expect(calls[0]).toEqual([4324, 'localhost', expect.any(Function)]);
	});

	it('host 未指定なら listen に host を渡さない（全インターフェースを probe）', async () => {
		const { calls, restore } = spyOnListen();
		try {
			await findFreePort(4324);
		} finally {
			restore();
		}
		expect(calls[0]).toEqual([4324, expect.any(Function)]);
	});

	it('指定 host で使用中のポートはその host を probe してフォールバックする', async () => {
		// Behavioral smoke test on the real stack: a same-host conflict must fall
		// back to an ephemeral port (complements the deterministic spy tests).
		const server = net.createServer();
		await new Promise<void>((resolve) => {
			server.listen(0, '127.0.0.1', () => {
				resolve();
			});
		});
		occupied = server;
		const address = server.address();
		const inUse = typeof address === 'object' && address ? address.port : 0;

		const port = await findFreePort(inUse, '127.0.0.1');
		expect(port).toBeGreaterThan(0);
		expect(port).not.toBe(inUse);
	});
});
