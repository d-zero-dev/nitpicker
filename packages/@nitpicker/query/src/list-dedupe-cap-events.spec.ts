import fs from 'node:fs/promises';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listDedupeCapEvents } from './list-dedupe-cap-events.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_dedupe_cap_events__');

/**
 * Minimal archive config — listDedupeCapEvents reads from
 * `dedupe_cap_events` only, so anything beyond what `setConfig` requires is
 * irrelevant.
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

describe('listDedupeCapEvents', () => {
	let archive: InstanceType<typeof Archive>;

	beforeEach(async () => {
		archive = await buildArchive(`dedupe-cap-events-${Date.now()}.nitpicker`);
	});

	it('returns rows ordered by detected_at DESC (newest first)', async () => {
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/mid/{n}/',
			sampleUrl: 'https://example.com/mid/1/',
			bodyHash: Buffer.from('mid'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 2000,
		});
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/oldest/{n}/',
			sampleUrl: 'https://example.com/oldest/1/',
			bodyHash: Buffer.from('oldest'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/newest/{n}/',
			sampleUrl: 'https://example.com/newest/1/',
			bodyHash: Buffer.from('newest'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 3000,
		});

		const result = await listDedupeCapEvents(archive);
		expect(result.items.map((r) => r.shape_key)).toEqual([
			'example.com/newest/{n}/',
			'example.com/mid/{n}/',
			'example.com/oldest/{n}/',
		]);
		expect(result.total).toBe(3);
	});

	it('honours `limit` and `offset` for pagination', async () => {
		for (const detectedAt of [3000, 2000, 1000]) {
			await archive.insertDedupeCapEvent({
				shapeKey: `example.com/a/${detectedAt}/{n}/`,
				sampleUrl: `https://example.com/a/${detectedAt}/1/`,
				bodyHash: Buffer.from(String(detectedAt)),
				effectiveThreshold: 50,
				observedCount: 100,
				detectedAt,
			});
		}

		const firstPage = await listDedupeCapEvents(archive, { limit: 2 });
		expect(firstPage.items).toHaveLength(2);
		expect(firstPage.total).toBe(3);

		const secondPage = await listDedupeCapEvents(archive, { limit: 2, offset: 2 });
		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.total).toBe(3);
	});

	it('負のofferやlimitを渡してもdefaultへフォールバックする（knexへ不正な値を渡さない）', async () => {
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});

		await expect(
			listDedupeCapEvents(archive, { limit: -1, offset: -1 }),
		).resolves.toEqual({
			items: expect.arrayContaining([
				expect.objectContaining({ id: expect.any(Number) }),
			]),
			total: 1,
		});
	});

	it('returns every column, with body_hash as a hex string', async () => {
		const id = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/full/{n}/',
			sampleUrl: 'https://example.com/full/1/',
			bodyHash: Buffer.from('full-fields'),
			effectiveThreshold: 25,
			observedCount: 50,
			detectedAt: 1000,
		});
		await archive.finalizeDedupeCapEvent(id, 999);

		const result = await listDedupeCapEvents(archive);
		expect(result.items[0]).toMatchObject({
			shape_key: 'example.com/full/{n}/',
			sample_url: 'https://example.com/full/1/',
			effective_threshold: 25,
			observed_count: 50,
			detected_at: 1000,
			rejected_count: 999,
		});
		expect(result.items[0]?.body_hash).toBe(Buffer.from('full-fields').toString('hex'));
		expect(typeof result.items[0]?.id).toBe('number');
	});

	it('rejected_count が未確定（crawlEnd未到達）のときnullをそのまま返す', async () => {
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/unfinalized/{n}/',
			sampleUrl: 'https://example.com/unfinalized/1/',
			bodyHash: Buffer.from('unfinalized'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});

		const result = await listDedupeCapEvents(archive);
		expect(result.items[0]?.rejected_count).toBeNull();
	});

	it('dedupe_cap_events が存在しない場合は空を返す（read-only / legacy archive fallback）', async () => {
		await archive.getKnex().schema.dropTableIfExists('dedupe_cap_events');
		const result = await listDedupeCapEvents(archive);
		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});

	it('テーブルはあるが記録が無い場合は空を返す', async () => {
		const result = await listDedupeCapEvents(archive);
		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});
});
