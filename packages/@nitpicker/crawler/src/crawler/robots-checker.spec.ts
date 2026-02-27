import http from 'node:http';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { RobotsChecker } from './robots-checker.js';

const ROBOTS_TXT = `
User-agent: *
Disallow: /secret/
Allow: /

User-agent: Nitpicker
Disallow: /admin/
`;

let server: http.Server;
let port: number;

beforeAll(async () => {
	server = http.createServer((req, res) => {
		if (req.url === '/robots.txt') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(ROBOTS_TXT);
		} else {
			res.writeHead(200);
			res.end('ok');
		}
	});
	await new Promise<void>((resolve) => {
		server.listen(0, () => resolve());
	});
	const address = server.address();
	port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(async () => {
	await new Promise<void>((resolve) => {
		server.close(() => resolve());
	});
});

describe('RobotsChecker', () => {
	it('blocks URLs disallowed by robots.txt', async () => {
		const checker = new RobotsChecker('Nitpicker', true);
		const url = parseUrl(`http://127.0.0.1:${port}/admin/settings`)!;
		const result = await checker.isAllowed(url);
		expect(result).toBe(false);
	});

	it('allows URLs permitted by robots.txt', async () => {
		const checker = new RobotsChecker('Nitpicker', true);
		const url = parseUrl(`http://127.0.0.1:${port}/public/page`)!;
		const result = await checker.isAllowed(url);
		expect(result).toBe(true);
	});

	it('always allows when disabled', async () => {
		const checker = new RobotsChecker('Nitpicker', false);
		const url = parseUrl(`http://127.0.0.1:${port}/admin/settings`)!;
		const result = await checker.isAllowed(url);
		expect(result).toBe(true);
	});

	it('allows non-HTTP URLs', async () => {
		const checker = new RobotsChecker('Nitpicker', true);
		const url = parseUrl('mailto:test@example.com')!;
		const result = await checker.isAllowed(url);
		expect(result).toBe(true);
	});

	it('allows all URLs when robots.txt is absent', async () => {
		const noRobotsServer = http.createServer((_req, res) => {
			res.writeHead(404);
			res.end();
		});
		await new Promise<void>((resolve) => {
			noRobotsServer.listen(0, () => resolve());
		});
		const address = noRobotsServer.address();
		const noRobotsPort = typeof address === 'object' && address ? address.port : 0;

		try {
			const checker = new RobotsChecker('Nitpicker', true);
			const url = parseUrl(`http://127.0.0.1:${noRobotsPort}/secret/page`)!;
			const result = await checker.isAllowed(url);
			expect(result).toBe(true);
		} finally {
			await new Promise<void>((resolve) => {
				noRobotsServer.close(() => resolve());
			});
		}
	});

	it('caches robots.txt per origin', async () => {
		const checker = new RobotsChecker('Nitpicker', true);
		const url1 = parseUrl(`http://127.0.0.1:${port}/admin/page1`)!;
		const url2 = parseUrl(`http://127.0.0.1:${port}/admin/page2`)!;

		await checker.isAllowed(url1);
		const result = await checker.isAllowed(url2);
		expect(result).toBe(false);
	});
});
