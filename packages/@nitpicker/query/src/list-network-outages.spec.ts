import fs from 'node:fs/promises';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listNetworkOutages } from './list-network-outages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_network_outages__');

/**
 * Minimal archive config — listNetworkOutages reads from `network_outages`
 * (plus `crawl_errors` / `content_items` for the open-row clamp) only, so
 * anything beyond what `setConfig` requires is irrelevant.
 * @param fileName
 */
async function buildArchive(fileName: string) {
	await fs.mkdir(workingDir, { recursive: true });
	const archiveFilePath = path.resolve(workingDir, fileName);
	await fs.rm(archiveFilePath, { force: true });
	const archive = await Archive.create({
		filePath: archiveFilePath,
		cwd: workingDir,
	});
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.13.0',
		recursive: true,
		interval: 0,
		image: false,
		fetchExternal: false,
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
	});
	return archive;
}

afterAll(async () => {
	await fs.rm(workingDir, { recursive: true, force: true });
});

describe('listNetworkOutages', () => {
	let archive: InstanceType<typeof Archive>;

	beforeEach(async () => {
		archive = await buildArchive(`network-outages-${Date.now()}.nitpicker`);
	});

	it('returns rows ordered by started_at DESC (newest first)', async () => {
		const midId = await archive.insertNetworkOutage({
			startedAt: 2000,
			detectedAt: 2100,
			probeHost: 'mid.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await archive.closeNetworkOutage(midId, 2500);
		const oldestId = await archive.insertNetworkOutage({
			startedAt: 1000,
			detectedAt: 1100,
			probeHost: 'oldest.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await archive.closeNetworkOutage(oldestId, 1500);
		const newestId = await archive.insertNetworkOutage({
			startedAt: 3000,
			detectedAt: 3100,
			probeHost: 'newest.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await archive.closeNetworkOutage(newestId, 3500);

		const result = await listNetworkOutages(archive);
		expect(result.items.map((r) => r.probe_host)).toEqual([
			'newest.example',
			'mid.example',
			'oldest.example',
		]);
		expect(result.total).toBe(3);
	});

	it('honours `limit` and `offset` for pagination', async () => {
		for (const startedAt of [3000, 2000, 1000]) {
			const id = await archive.insertNetworkOutage({
				startedAt,
				detectedAt: startedAt + 100,
				probeHost: 'a.example',
				triggerErrorCount: 5,
				triggerHostCount: 2,
			});
			await archive.closeNetworkOutage(id, startedAt + 500);
		}

		const firstPage = await listNetworkOutages(archive, { limit: 2 });
		expect(firstPage.items).toHaveLength(2);
		expect(firstPage.total).toBe(3);

		const secondPage = await listNetworkOutages(archive, { limit: 2, offset: 2 });
		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.total).toBe(3);
	});

	it('returns every column from a closed row', async () => {
		const id = await archive.insertNetworkOutage({
			startedAt: 1000,
			detectedAt: 1100,
			probeHost: 'full-fields.example',
			triggerErrorCount: 7,
			triggerHostCount: 3,
		});
		await archive.closeNetworkOutage(id, 1500);

		const result = await listNetworkOutages(archive);
		expect(result.items[0]).toMatchObject({
			started_at: 1000,
			detected_at: 1100,
			ended_at: 1500,
			probe_host: 'full-fields.example',
			trigger_error_count: 7,
			trigger_host_count: 3,
		});
		expect(typeof result.items[0]?.id).toBe('number');
	});

	it('resolves a still-open row (crashed session) to the archive-activity clamp instead of null', async () => {
		await archive.insertNetworkOutage({
			startedAt: 1000,
			detectedAt: 1100,
			probeHost: 'still-open.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await archive.getKnex()('crawl_errors').insert({
			url: 'https://a.example/',
			isExternal: 0,
			message: 'getaddrinfo ENOTFOUND a.example',
			createdAt: 9000,
		});

		const result = await listNetworkOutages(archive);
		expect(result.items[0]?.ended_at).toBe(9000);
		expect(result.items[0]?.ended_at).not.toBeNull();
	});

	it('returns an empty result when network_outages is missing (read-only / legacy archive fallback)', async () => {
		await archive.getKnex().schema.dropTableIfExists('network_outages');
		const result = await listNetworkOutages(archive);
		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});

	it('returns an empty result when the table exists but no outages have been recorded', async () => {
		const result = await listNetworkOutages(archive);
		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});
});
