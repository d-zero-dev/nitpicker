import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { ArchiveManager } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_register_dedupe_cap_events_route__',
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

/** Response shape of `GET /api/dedupe-cap-events`. */
interface DedupeCapEventsResponseBody {
	items: {
		id: number;
		shape_key: string;
		sample_url: string;
		body_hash: string | null;
		effective_threshold: number;
		observed_count: number;
		detected_at: number;
		rejected_count: number | null;
	}[];
	total: number;
}

describe('registerDedupeCapEventsRoute — /api/dedupe-cap-events (integration)', () => {
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

		const eventId = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/news/date/{n}/',
			sampleUrl: 'https://example.com/news/date/2024/',
			bodyHash: Buffer.from('trap-body'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		await archive.finalizeDedupeCapEvent(eventId, 500);

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
			publicDir: '/tmp/no-such-dir-register-dedupe-cap-events-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns the recorded dedupe-cap event', async () => {
		const res = await app.request('/api/dedupe-cap-events');
		const body = (await res.json()) as DedupeCapEventsResponseBody;
		expect(body.total).toBe(1);
		expect(body.items[0]).toMatchObject({
			shape_key: 'example.com/news/date/{n}/',
			sample_url: 'https://example.com/news/date/2024/',
			effective_threshold: 50,
			observed_count: 100,
			detected_at: 1000,
			rejected_count: 500,
		});
	});
});

describe('registerDedupeCapEventsRoute — no events recorded', () => {
	const emptyWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_register_dedupe_cap_events_route_empty__',
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
			publicDir: '/tmp/no-such-dir-register-dedupe-cap-events-route-spec-empty',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(emptyWorkingDir, { recursive: true, force: true });
	});

	it('returns an empty list', async () => {
		const res = await app.request('/api/dedupe-cap-events');
		const body = (await res.json()) as DedupeCapEventsResponseBody;
		expect(body).toEqual({ items: [], total: 0 });
	});
});
