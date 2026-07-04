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

describe('registerErrorKindsRoute — /api/error-kinds (integration)', () => {
	describe('fast path (viewer_error_kind_* read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_error_kinds_route_fast__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the classified breakdown with per-host counts', async () => {
			const res = await fixture.app.request('/api/error-kinds');
			const body = (await res.json()) as {
				total: number;
				channelSource: string;
				groups: {
					kind: string;
					count: number;
					hosts: { host: string; count: number }[];
				}[];
			};
			expect(body.total).toBe(3);
			expect(body.channelSource).toBe('crawl_errors');
			const dns = body.groups.find((g) => g.kind === 'dns');
			expect(dns).toMatchObject({
				count: 2,
				hosts: [{ host: 'ext.example.net', count: 2 }],
			});
		});
	});

	describe('legacy fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_error_kinds_route_legacy__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, false);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the same classified breakdown via the legacy live query', async () => {
			const res = await fixture.app.request('/api/error-kinds');
			const body = (await res.json()) as {
				total: number;
				channelSource: string;
				groups: {
					kind: string;
					count: number;
					hosts: { host: string; count: number }[];
				}[];
			};
			expect(body.total).toBe(3);
			expect(body.channelSource).toBe('crawl_errors');
			const dns = body.groups.find((g) => g.kind === 'dns');
			expect(dns).toMatchObject({
				count: 2,
				hosts: [{ host: 'ext.example.net', count: 2 }],
			});
		});
	});
});
