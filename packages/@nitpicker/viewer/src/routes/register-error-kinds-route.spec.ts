import type { CrawlerError } from '@nitpicker/crawler';

import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { ArchiveManager, buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.10.0',
	recursive: true,
	interval: 0,
	image: false,
	fetchExternal: true,
	parallels: 1,
	roots: ['https://example.com'],
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 0,
	retry: 3,
	fromList: false,
	disableQueries: false,
	userAgent: 'test',
	ignoreRobots: false,
};

/** Response shape of `GET /api/error-kinds`. */
interface ErrorKindsResponseBody {
	items: { host: string; kind: string; count: number; sampleUrls: string[] }[];
	total: number;
	facets: { totalRecords: number; channelSource: string };
}

/**
 * Build a `CrawlerError` for the crawler-level `error` channel.
 * @param url - The URL the error is about, or `null` for a process-level error.
 * @param message - The raw error message.
 * @param isExternal - Whether the URL is external.
 * @returns A `CrawlerError` accepted by `Archive.addError`.
 */
function crawlerError(
	url: string | null,
	message: string,
	isExternal = false,
): CrawlerError {
	return { pid: 1, isMainProcess: true, url, isExternal, error: new Error(message) };
}

/**
 * Builds a fixture archive with a DNS failure (2 occurrences on the same
 * host) and a connection-refused failure, and returns an in-process Hono
 * app wired to it via the same read-only-open path the real viewer uses,
 * mirroring `register-links-route.spec.ts`'s `buildFixture` helper.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_error_kind_*` read
 *   model before opening read-only (exercises the fast path) or leave it
 *   unbuilt (exercises the legacy fallback path).
 * @returns The app, archive, and manager — callers must close both in
 *   `afterAll`.
 */
async function buildFixture(workingDir: string, withReadModel: boolean) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);

	await archive.addError(
		crawlerError(
			'http://ext.example.net/x',
			'getaddrinfo ENOTFOUND ext.example.net',
			true,
		),
	);
	await archive.addError(
		crawlerError(
			'http://ext.example.net/y',
			'getaddrinfo ENOTFOUND ext.example.net',
			true,
		),
	);
	await archive.addError(
		crawlerError('https://api.example.org/', 'connect ECONNREFUSED 10.0.0.1:443', true),
	);

	if (withReadModel) {
		await buildViewerReadModel(archive);
	}

	const manager = new ArchiveManager();
	const { archiveId, mode } = await manager.open(archive.tmpDir);
	const app = createApp({
		context: {
			manager,
			archiveId,
			filePath: archive.tmpDir,
			mode,
			crawlerLockHolder: null,
		},
		publicDir: '/tmp/no-such-dir-register-error-kinds-route-spec',
	});
	return { app, archive, manager };
}

describe.each([
	{ label: 'fast path (viewer_error_kind_* read model built)', withReadModel: true },
	{ label: 'legacy fallback path (no read model built)', withReadModel: false },
])(
	'registerErrorKindsRoute — /api/error-kinds (integration) — $label',
	({ withReadModel }) => {
		const workingDir = path.resolve(
			__dirname,
			`__test_fixtures_register_error_kinds_route_${withReadModel ? 'fast' : 'legacy'}__`,
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, withReadModel);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the classified host×kind breakdown, sorted by count descending by default', async () => {
			const res = await fixture.app.request('/api/error-kinds');
			const body = (await res.json()) as ErrorKindsResponseBody;
			expect(body.total).toBe(2);
			expect(body.facets).toEqual({ totalRecords: 3, channelSource: 'crawl_errors' });
			expect(body.items[0]).toMatchObject({
				host: 'ext.example.net',
				kind: 'dns',
				count: 2,
				sampleUrls: ['http://ext.example.net/x', 'http://ext.example.net/y'],
			});
			expect(body.items[1]).toMatchObject({
				host: 'api.example.org',
				kind: 'connection-refused',
				count: 1,
			});
		});

		it('honors the ?kind= query filter', async () => {
			const res = await fixture.app.request('/api/error-kinds?kind=connection-refused');
			const body = (await res.json()) as ErrorKindsResponseBody;
			expect(body.items).toHaveLength(1);
			expect(body.items[0]).toMatchObject({ host: 'api.example.org' });
			// facets stay archive-wide, unaffected by the kind filter.
			expect(body.facets.totalRecords).toBe(3);
		});

		it('honors the ?host= query filter', async () => {
			const res = await fixture.app.request('/api/error-kinds?host=ext.example.net');
			const body = (await res.json()) as ErrorKindsResponseBody;
			expect(body.items).toHaveLength(1);
			expect(body.items[0]).toMatchObject({ kind: 'dns', count: 2 });
		});

		it('honors ?sortBy=host&sortOrder=asc', async () => {
			const res = await fixture.app.request('/api/error-kinds?sortBy=host&sortOrder=asc');
			const body = (await res.json()) as ErrorKindsResponseBody;
			expect(body.items.map((i) => i.host)).toEqual([
				'api.example.org',
				'ext.example.net',
			]);
		});

		it('honors ?limit=&?offset=', async () => {
			const res = await fixture.app.request(
				'/api/error-kinds?sortBy=host&sortOrder=asc&limit=1&offset=1',
			);
			const body = (await res.json()) as ErrorKindsResponseBody;
			expect(body.items).toHaveLength(1);
			expect(body.items[0]).toMatchObject({ host: 'ext.example.net' });
			expect(body.total).toBe(2);
		});
	},
);
