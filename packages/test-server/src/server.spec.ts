import type { Server } from 'node:http';

import { describe, expect, it } from 'vitest';

import { startServer } from './server.js';

/**
 * @param server
 */
function closeServer(server: Server): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}

describe('startServer', () => {
	it('assigns a real TCP port by default instead of a fixed one', async () => {
		const server = await startServer();
		try {
			const address = server.address();
			expect(address).not.toBeNull();
			expect(typeof address).not.toBe('string');
			expect((address as { port: number }).port).toBeGreaterThan(0);
		} finally {
			await closeServer(server);
		}
	});

	it('lets two concurrent instances bind to different ports without EADDRINUSE (#162)', async () => {
		const [serverA, serverB] = await Promise.all([startServer(), startServer()]);
		try {
			const portA = (serverA.address() as { port: number }).port;
			const portB = (serverB.address() as { port: number }).port;
			expect(portA).not.toBe(portB);
		} finally {
			await Promise.all([closeServer(serverA), closeServer(serverB)]);
		}
	});
});
