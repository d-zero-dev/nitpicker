import type { Server } from 'node:http';
import type { TestProject } from 'vitest/node';

let server: Server;

/**
 * Starts the E2E test server on an OS-assigned port and shares the actual
 * port with test files via vitest's provide/inject channel — a fixed port
 * made concurrent worktrees/sessions collide with `EADDRINUSE` (#162).
 * @param project - The vitest project, used to `provide` the resolved port.
 */
export async function setup(project: TestProject) {
	const { startServer } = await import('../../../src/server.js');
	server = await startServer();
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('[global-setup] test server did not report a TCP port');
	}
	project.provide('testServerPort', address.port);
	console.log(`[global-setup] Test server started on port ${address.port}`); // eslint-disable-line no-console
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
