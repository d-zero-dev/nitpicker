import http from 'node:http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { fetchRobotsTxt } from './fetch-robots-txt.js';

const ROBOTS_TXT = `
User-agent: *
Disallow: /secret/
Allow: /public/

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
			res.writeHead(404);
			res.end();
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

describe('fetchRobotsTxt', () => {
	it('returns a parsed Robot object for a valid robots.txt', async () => {
		const robot = await fetchRobotsTxt(`http://127.0.0.1:${port}`);
		expect(robot).not.toBeNull();
		expect(robot!.isAllowed(`http://127.0.0.1:${port}/public/page`, '*')).toBe(true);
		expect(robot!.isAllowed(`http://127.0.0.1:${port}/secret/page`, '*')).toBe(false);
	});

	it('respects user-agent specific rules', async () => {
		const robot = await fetchRobotsTxt(`http://127.0.0.1:${port}`);
		expect(robot).not.toBeNull();
		expect(robot!.isAllowed(`http://127.0.0.1:${port}/admin/page`, 'Nitpicker')).toBe(
			false,
		);
	});

	it('returns null when robots.txt does not exist', async () => {
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
			const robot = await fetchRobotsTxt(`http://127.0.0.1:${noRobotsPort}`);
			expect(robot).toBeNull();
		} finally {
			await new Promise<void>((resolve) => {
				noRobotsServer.close(() => resolve());
			});
		}
	});

	it('returns null when the server is unreachable', async () => {
		const robot = await fetchRobotsTxt('http://127.0.0.1:1');
		expect(robot).toBeNull();
	});
});
