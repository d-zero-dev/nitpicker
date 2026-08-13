import type { Server } from 'node:http';

import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { scanJsResourceForLicenseComment } from './scan-js-resource-for-license-comment.js';

/**
 * Starts a throwaway local HTTP server on an OS-assigned port so the
 * byte-cap streaming logic runs over a real socket, not a mocked one — the
 * same rationale `fetch-destination.spec.ts` documents for leaving its own
 * network internals untested by mock (real `follow-redirects` behavior
 * against sockets is what actually matters here).
 * @param handler - The request handler.
 * @returns The listening server and its base URL.
 */
async function startServer(
	handler: Parameters<typeof createServer>[0],
): Promise<{ server: Server; baseUrl: string }> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (address == null || typeof address === 'string') {
		throw new Error('Expected a network address');
	}
	return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('scanJsResourceForLicenseComment', () => {
	let server: Server | undefined;

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
	});

	it('returns the matching signal when a known license comment appears within the byte limit', async () => {
		const started = await startServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end('/*!\n * Vue.js v3.4.21\n * (c) 2014-2024 Evan You\n */\nconsole.log(1);');
		});
		server = started.server;

		const signal = await scanJsResourceForLicenseComment(`${started.baseUrl}/app.js`);

		expect(signal).toMatchObject({ technology: 'Vue', signalType: 'js-license-comment' });
	});

	it('returns null when the body contains no known license comment', async () => {
		const started = await startServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end('console.log("no framework fingerprint here");');
		});
		server = started.server;

		const signal = await scanJsResourceForLicenseComment(`${started.baseUrl}/app.js`);

		expect(signal).toBeNull();
	});

	it('destroys the connection at byteLimit, never reading a match that appears later in a long response', async () => {
		const started = await startServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.write('a'.repeat(20_000));
			res.end('/*!\n * Vue.js v3.4.21\n */');
		});
		server = started.server;

		const signal = await scanJsResourceForLicenseComment(`${started.baseUrl}/app.js`, {
			byteLimit: 100,
		});

		expect(signal).toBeNull();
	});

	it('returns null on a non-2xx response', async () => {
		const started = await startServer((req, res) => {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('not found');
		});
		server = started.server;

		const signal = await scanJsResourceForLicenseComment(`${started.baseUrl}/missing.js`);

		expect(signal).toBeNull();
	});

	it('returns null when the request exceeds the configured timeout', async () => {
		const started = await startServer((req, res) => {
			// Never respond — simulates a hung connection.
			void req;
			void res;
		});
		server = started.server;

		const signal = await scanJsResourceForLicenseComment(`${started.baseUrl}/slow.js`, {
			timeout: 50,
		});

		expect(signal).toBeNull();
	});

	it('returns null when the host cannot be reached at all', async () => {
		const signal = await scanJsResourceForLicenseComment(
			'http://127.0.0.1:1/unreachable.js',
			{
				timeout: 500,
			},
		);

		expect(signal).toBeNull();
	});
});
