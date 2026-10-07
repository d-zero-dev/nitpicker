import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import http from 'node:http';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { destinationCache } from './destination-cache.js';
import { fetchDestination } from './fetch-destination.js';

interface TestServer {
	readonly origin: string;
	readonly received: IncomingHttpHeaders[];
	readonly server: Server;
}

/**
 * Starts a loopback HTTP server that records the headers of every request it
 * receives. Redirect routes (all 302):
 * - `/redirect-in` → `/landing` on the same server
 * - `/redirect-out` → `/landing` on the OTHER server (`otherOrigin()`)
 * - `/redirect-to-outside-path` → `/outside/landing` on the same server
 *   (same host and port, different path — a scope boundary follow-redirects
 *   cannot see)
 * - `/bounce` → `/redirect-out` on the OTHER server, which sends the request
 *   back to this server's `/landing` (out of scope and back in again)
 *
 * Redirects are selected by PATH, not a query parameter: `fetchDestination`
 * deliberately requests `url.pathname` only (the query is dropped, see
 * `redirectPaths`' `slice(1)` note in ARCHITECTURE.md).
 * @param otherOrigin - Lazily resolves the origin of the other server.
 * @returns The server handle with its origin and the recorded headers.
 */
async function startServer(otherOrigin: () => string): Promise<TestServer> {
	const received: IncomingHttpHeaders[] = [];
	const server = http.createServer((req, res) => {
		received.push(req.headers);
		const pathname = new URL(req.url ?? '/', 'http://placeholder').pathname;
		if (pathname === '/redirect-in') {
			res.writeHead(302, { Location: '/landing' });
			res.end();
			return;
		}
		if (pathname === '/redirect-out') {
			res.writeHead(302, { Location: `${otherOrigin()}/landing` });
			res.end();
			return;
		}
		if (pathname === '/redirect-to-outside-path') {
			res.writeHead(302, { Location: '/outside/landing' });
			res.end();
			return;
		}
		if (pathname === '/bounce') {
			res.writeHead(302, { Location: `${otherOrigin()}/redirect-out` });
			res.end();
			return;
		}
		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end('<title>t</title>');
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return { origin: `http://127.0.0.1:${port}`, received, server };
}

let scope: TestServer;
let outside: TestServer;

beforeAll(async () => {
	scope = await startServer(() => outside.origin);
	outside = await startServer(() => scope.origin);
});

afterAll(async () => {
	for (const { server } of [scope, outside]) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

beforeEach(() => {
	destinationCache.clear();
	scope.received.length = 0;
	outside.received.length = 0;
});

/**
 * Whether an absolute URL is inside the in-process "crawl scope" (the first server).
 * @param href - Absolute URL to classify.
 * @returns `true` for URLs under the scoped server's origin.
 */
function isInScope(href: string) {
	return href.startsWith(`${scope.origin}/`);
}

describe('fetchDestination request headers', () => {
	it('sends the extra headers to an in-scope URL', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/page`)!,
			isExternal: false,
			requestHeaders: { Authorization: 'Bearer t', 'X-Api-Key': 'k' },
			isInScope,
		});

		expect(scope.received).toHaveLength(1);
		expect(scope.received[0]!.authorization).toBe('Bearer t');
		expect(scope.received[0]!['x-api-key']).toBe('k');
	});

	it('never sends them to an external URL', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/page-external`)!,
			isExternal: true,
			requestHeaders: { Authorization: 'Bearer t', 'X-Api-Key': 'k' },
			isInScope,
		});

		expect(scope.received).toHaveLength(1);
		expect(scope.received[0]!.authorization).toBeUndefined();
		expect(scope.received[0]!['x-api-key']).toBeUndefined();
	});

	it('keeps the headers across a redirect that stays in scope', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/redirect-in`)!,
			isExternal: false,
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope,
		});

		expect(scope.received).toHaveLength(2);
		expect(scope.received[1]!['x-api-key']).toBe('k');
	});

	it('drops custom headers on a redirect that leaves the scope', async () => {
		// `X-Api-Key` is not one of the headers follow-redirects strips on its
		// own, so this exercises the crawler's own `beforeRedirect` hook.
		await fetchDestination({
			url: parseUrl(`${scope.origin}/redirect-out`)!,
			isExternal: false,
			requestHeaders: { Authorization: 'Bearer t', 'X-Api-Key': 'k' },
			isInScope,
		});

		expect(scope.received[0]!['x-api-key']).toBe('k');
		expect(outside.received).toHaveLength(1);
		expect(outside.received[0]!['x-api-key']).toBeUndefined();
		expect(outside.received[0]!.authorization).toBeUndefined();
	});

	it('fails closed on redirects when no scope predicate is given', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/redirect-in`)!,
			isExternal: false,
			requestHeaders: { 'X-Api-Key': 'k' },
		});

		expect(scope.received[0]!['x-api-key']).toBe('k');
		expect(scope.received[1]!['x-api-key']).toBeUndefined();
	});

	it('lets an explicit Authorization header win over URL-embedded Basic credentials', async () => {
		await fetchDestination({
			url: parseUrl(`http://user:pass@${scope.origin.replace('http://', '')}/page-auth`)!,
			isExternal: false,
			requestHeaders: { Authorization: 'Bearer t' },
			isInScope,
		});

		expect(scope.received[0]!.authorization).toBe('Bearer t');
	});

	it('still sends Basic credentials from the URL when no Authorization header is given', async () => {
		await fetchDestination({
			url: parseUrl(
				`http://user:pass@${scope.origin.replace('http://', '')}/page-basic`,
			)!,
			isExternal: false,
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope,
		});

		expect(scope.received[0]!.authorization).toBe(
			`Basic ${Buffer.from('user:pass').toString('base64')}`,
		);
	});

	it('sends no extra headers when none are configured', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/page-plain`)!,
			isExternal: false,
		});

		expect(scope.received[0]!.authorization).toBeUndefined();
	});

	it('drops the headers on a redirect to an out-of-scope PATH on the same host and port', async () => {
		// follow-redirects sees the same host and keeps even `Authorization`
		// here, so only the crawler's own hook can protect this boundary.
		await fetchDestination({
			url: parseUrl(`${scope.origin}/redirect-to-outside-path`)!,
			isExternal: false,
			requestHeaders: { Authorization: 'Bearer t', 'X-Api-Key': 'k' },
			isInScope: (href) => !href.includes('/outside/'),
		});

		expect(scope.received).toHaveLength(2);
		expect(scope.received[0]!.authorization).toBe('Bearer t');
		expect(scope.received[1]!.authorization).toBeUndefined();
		expect(scope.received[1]!['x-api-key']).toBeUndefined();
	});

	it('does not restore the headers when a redirect leaves the scope and comes back in', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/bounce`)!,
			isExternal: false,
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope,
		});

		// scope/bounce → outside/redirect-out → scope/landing
		expect(scope.received).toHaveLength(2);
		expect(scope.received[0]!['x-api-key']).toBe('k');
		expect(outside.received).toHaveLength(1);
		expect(outside.received[0]!['x-api-key']).toBeUndefined();
		expect(scope.received[1]!['x-api-key']).toBeUndefined();
	});

	it('replaces a base header of a different casing instead of sending both', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/page-accept`)!,
			isExternal: false,
			requestHeaders: { accept: 'application/json' },
			isInScope,
		});

		expect(scope.received[0]!.accept).toBe('application/json');
	});

	it('sends the headers on the title-only GET (titleBytesLimit)', async () => {
		const result = await fetchDestination({
			url: parseUrl(`${scope.origin}/page-title`)!,
			isExternal: false,
			method: 'GET',
			options: { titleBytesLimit: 16_384 },
			userAgent: 'TestAgent/1',
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope,
		});

		expect(result.meta.title).toBe('t');
		expect(scope.received[0]!['x-api-key']).toBe('k');
		expect(scope.received[0]!['user-agent']).toBe('TestAgent/1');
	});

	it('does not send the headers on the title-only GET of an external URL', async () => {
		await fetchDestination({
			url: parseUrl(`${scope.origin}/page-title-external`)!,
			isExternal: true,
			method: 'GET',
			options: { titleBytesLimit: 16_384 },
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope,
		});

		expect(scope.received[0]!['x-api-key']).toBeUndefined();
	});

	describe.concurrent('GET fallback after a HEAD refusal', () => {
		/**
		 * Serves `status` for HEAD and 200 for GET, recording every request.
		 * @param status - The status HEAD is refused with.
		 * @param run - Receives the server origin; resolves when the scenario is done.
		 * @returns The recorded `method` + headers of every request.
		 */
		async function withRefusingServer(
			status: number,
			run: (origin: string) => Promise<void>,
		) {
			const seen: { method?: string; headers: IncomingHttpHeaders }[] = [];
			const server = http.createServer((req, res) => {
				seen.push({ method: req.method, headers: req.headers });
				if (req.method === 'HEAD') {
					res.writeHead(status);
					res.end();
					return;
				}
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end('ok');
			});
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			const { port } = server.address() as AddressInfo;
			try {
				await run(`http://127.0.0.1:${port}`);
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
			return seen;
		}

		// 501 and 503 wait 5 s before the GET retry (`fetchDestination`'s own delay).
		it.concurrent.each([405, 501, 503])(
			'forwards the headers and User-Agent to the GET sent after a HEAD %i',
			async (status) => {
				const seen = await withRefusingServer(status, async (origin) => {
					await fetchDestination({
						url: parseUrl(`${origin}/needs-get-${status}`)!,
						isExternal: false,
						userAgent: 'TestAgent/1',
						requestHeaders: { 'X-Api-Key': 'k' },
						isInScope: (href) => href.startsWith(`${origin}/`),
					});
				});

				const get = seen.find((entry) => entry.method === 'GET');
				expect(get).toBeDefined();
				expect(get!.headers['x-api-key']).toBe('k');
				expect(get!.headers['user-agent']).toBe('TestAgent/1');
			},
			20_000,
		);

		it('does not send the headers on the GET fallback of an external URL', async () => {
			const seen = await withRefusingServer(405, async (origin) => {
				await fetchDestination({
					url: parseUrl(`${origin}/needs-get-external`)!,
					isExternal: true,
					userAgent: 'TestAgent/1',
					requestHeaders: { 'X-Api-Key': 'k' },
					isInScope: (href) => href.startsWith(`${origin}/`),
				});
			});

			const get = seen.find((entry) => entry.method === 'GET');
			expect(get).toBeDefined();
			expect(get!.headers['x-api-key']).toBeUndefined();
			expect(get!.headers['user-agent']).toBe('TestAgent/1');
		});
	});
});
