import type { Server } from 'node:http';

let server: Server;

/**
 *
 */
export async function setup() {
	const { startServer } = await import('../../../src/index.js');
	server = await startServer(8010);
	console.log('[global-setup] Test server started on port 8010'); // eslint-disable-line no-console
}

/**
 *
 */
export async function teardown() {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}
