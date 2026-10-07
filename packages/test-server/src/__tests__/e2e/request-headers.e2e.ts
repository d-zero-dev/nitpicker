import fs from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_ORIGIN, TEST_SERVER_PORT } from './test-server-port.js';

/** Each crawl launches a browser per in-scope page. */
const CRAWL_TIMEOUT_MS = 120_000;

const API_KEY = 'e2e-api-key';
const BEARER_TOKEN = 'e2e-bearer-token';
const ENTRY_URL = `http://localhost:${TEST_SERVER_PORT}/request-headers/`;

interface RecordedRequest {
	readonly host: string;
	readonly method: string;
	readonly path: string;
	readonly apiKey: string | null;
	readonly authorization: string | null;
}

/** Clears the test-server's request record so earlier crawls cannot bleed in. */
async function resetLog(): Promise<void> {
	const response = await fetch(`${TEST_SERVER_ORIGIN}/request-headers/reset`, {
		method: 'POST',
	});
	if (!response.ok) {
		throw new Error(`Failed to reset the request log (status ${response.status})`);
	}
}

/**
 * Reads every request the test-server recorded under `/request-headers/*`.
 * @returns Recorded requests in arrival order.
 */
async function readLog(): Promise<RecordedRequest[]> {
	const response = await fetch(`${TEST_SERVER_ORIGIN}/request-headers/log`);
	const json = (await response.json()) as { requests: RecordedRequest[] };
	return json.requests;
}

const isOffScope = (request: RecordedRequest) => request.host.startsWith('127.0.0.1');

describe('Request headers (E2E): crawl with headers', () => {
	let result: CrawlResult;
	let log: RecordedRequest[];

	beforeAll(async () => {
		await resetLog();
		result = await crawl([ENTRY_URL], {
			requestHeaders: { 'X-Api-Key': API_KEY, Authorization: `Bearer ${BEARER_TOKEN}` },
		});
		log = await readLog();
	}, CRAWL_TIMEOUT_MS);

	afterAll(async () => {
		await cleanup(result);
	});

	it('reaches protected in-scope pages — the headers rode on both the HEAD pre-flight and the browser', async () => {
		// The protected pages answer 401 without the key, so a 200 proves it.
		const pages = await result.accessor.getPages();
		const main = pages.find((p) => p.url.pathname === '/request-headers/');
		expect(main?.status).toBe(200);
		const inScopePage = pages.find((p) =>
			p.url.href.includes('/request-headers/inscope-page'),
		);
		expect(inScopePage?.status).toBe(200);
	});

	it('attaches the headers to in-scope sub-resources', () => {
		const assets = log.filter(
			(r) => !isOffScope(r) && r.path.endsWith('/inscope-asset.png'),
		);
		expect(assets.length).toBeGreaterThan(0);
		for (const request of assets) {
			expect(request.apiKey).toBe(API_KEY);
			expect(request.authorization).toBe(`Bearer ${BEARER_TOKEN}`);
		}
	});

	it('keeps the headers across an in-scope redirect', () => {
		// The landing page is protected: every request that reached it (the HEAD
		// hop and the browser) carried the key.
		const landing = log.filter(
			(r) => !isOffScope(r) && r.path.endsWith('/inscope-landing'),
		);
		expect(landing.length).toBeGreaterThan(0);
		for (const request of landing) {
			expect(request.apiKey).toBe(API_KEY);
		}
	});

	it('never sends the headers to anything off-scope (external link, external sub-resource, redirect hops)', () => {
		const offScope = log.filter((request) => isOffScope(request));

		// Guard against a vacuous pass: every off-scope path must actually have
		// been requested — the external sub-resource (browser), the external
		// link (HEAD pre-flight), the redirect landing (HEAD redirect hop) and the
		// off-scope target of an in-scope sub-resource's browser-side 302.
		for (const suffix of [
			'/external-asset.png',
			'/external-page',
			'/external-landing',
			'/external-redirected-asset.png',
		]) {
			expect(offScope.some((r) => r.path.endsWith(suffix))).toBe(true);
		}
		// `external-landing` was reached by a real GET as well (title fetch /
		// browser), not only by the HEAD redirect hop.
		expect(
			offScope.some((r) => r.path.endsWith('/external-landing') && r.method === 'GET'),
		).toBe(true);

		// Core invariant: nothing off-scope ever saw the headers.
		for (const request of offScope) {
			expect(request.apiKey).toBeNull();
			expect(request.authorization).toBeNull();
		}
	});

	it('records the header names — never the values — in the archive config', async () => {
		const config = await result.accessor.getConfig();
		expect(config.requestHeaderNames).toEqual(['X-Api-Key', 'Authorization']);
		expect(JSON.stringify(config)).not.toContain(API_KEY);
		expect(JSON.stringify(config)).not.toContain(BEARER_TOKEN);
	});

	it('writes the header values nowhere in the archive working directory', async () => {
		// Every file of the unpackaged archive (SQLite DB, WAL, blobs): a value
		// leaking into ANY table — response headers, resources, console logs —
		// would show up as raw bytes here, not just in the `info` row.
		const entries = await fs.readdir(result.tmpDir, {
			recursive: true,
			withFileTypes: true,
		});
		const files = entries.filter((entry) => entry.isFile());
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const bytes = await fs.readFile(path.join(file.parentPath, file.name));
			expect(bytes.includes(API_KEY), `${file.name} contains the X-Api-Key value`).toBe(
				false,
			);
			expect(
				bytes.includes(BEARER_TOKEN),
				`${file.name} contains the Authorization value`,
			).toBe(false);
		}
	});
});

describe('Request headers (E2E): crawl without headers', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		await resetLog();
		result = await crawl([ENTRY_URL]);
	}, CRAWL_TIMEOUT_MS);

	afterAll(async () => {
		await cleanup(result);
	});

	it('is unchanged: the protected entry page is recorded as 401 and no names are stored', async () => {
		const pages = await result.accessor.getPages();
		const main = pages.find((p) => p.url.pathname === '/request-headers/');
		expect(main?.status).toBe(401);

		const config = await result.accessor.getConfig();
		expect(config.requestHeaderNames).toEqual([]);
	});
});
