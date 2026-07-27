import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { ArchiveManager } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_register_network_outages_route__',
);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
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

/** Response shape of `GET /api/network-outages`. */
interface NetworkOutagesResponseBody {
	items: {
		id: number;
		started_at: number;
		detected_at: number;
		ended_at: number;
		probe_host: string | null;
		trigger_error_count: number;
		trigger_host_count: number;
	}[];
	total: number;
}

describe('registerNetworkOutagesRoute — /api/network-outages (integration)', () => {
	let archive: InstanceType<typeof Archive>;
	let manager: ArchiveManager;
	let app: ReturnType<typeof createApp>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'fixture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(BASE_CONFIG);

		const outageId = await archive.insertNetworkOutage({
			startedAt: 1000,
			detectedAt: 1100,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await archive.closeNetworkOutage(outageId, 1500);

		manager = new ArchiveManager();
		const { archiveId, mode } = await manager.open(archive.tmpDir);
		app = createApp({
			context: {
				manager,
				archiveId,
				filePath: archive.tmpDir,
				mode,
				crawlerLockHolder: null,
			},
			publicDir: '/tmp/no-such-dir-register-network-outages-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns the recorded outage', async () => {
		const res = await app.request('/api/network-outages');
		const body = (await res.json()) as NetworkOutagesResponseBody;
		expect(body.total).toBe(1);
		expect(body.items[0]).toMatchObject({
			started_at: 1000,
			detected_at: 1100,
			ended_at: 1500,
			probe_host: 'a.example',
			trigger_error_count: 5,
			trigger_host_count: 2,
		});
	});
});

describe('registerNetworkOutagesRoute — no outages recorded', () => {
	const emptyWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_register_network_outages_route_empty__',
	);
	let archive: InstanceType<typeof Archive>;
	let manager: ArchiveManager;
	let app: ReturnType<typeof createApp>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(emptyWorkingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(emptyWorkingDir, 'fixture.nitpicker'),
			cwd: emptyWorkingDir,
		});
		await archive.setConfig(BASE_CONFIG);

		manager = new ArchiveManager();
		const { archiveId, mode } = await manager.open(archive.tmpDir);
		app = createApp({
			context: {
				manager,
				archiveId,
				filePath: archive.tmpDir,
				mode,
				crawlerLockHolder: null,
			},
			publicDir: '/tmp/no-such-dir-register-network-outages-route-spec-empty',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(emptyWorkingDir, { recursive: true, force: true });
	});

	it('returns an empty list', async () => {
		const res = await app.request('/api/network-outages');
		const body = (await res.json()) as NetworkOutagesResponseBody;
		expect(body).toEqual({ items: [], total: 0 });
	});
});
