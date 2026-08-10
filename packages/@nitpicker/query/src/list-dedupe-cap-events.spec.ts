import fs from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listDedupeCapEvents } from './list-dedupe-cap-events.js';

const META = {
	lang: null,
	title: null,
	description: null,
	keywords: null,
	noindex: false,
	nofollow: false,
	noarchive: false,
	canonical: null,
	alternate: null,
	'og:type': null,
	'og:title': null,
	'og:site_name': null,
	'og:description': null,
	'og:url': null,
	'og:image': null,
	'twitter:card': null,
};

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

	it('captured_page_count is 0 and sample_url_archived is false when no page was ever crawled', async () => {
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});

		const result = await listDedupeCapEvents(archive);
		expect(result.items[0]?.captured_page_count).toBe(0);
		expect(result.items[0]?.sample_url_archived).toBe(false);
	});
});

describe('listDedupeCapEvents: captured_page_count / sample_url_archived', () => {
	let archive: InstanceType<typeof Archive>;

	beforeEach(async () => {
		archive = await buildArchive(`dedupe-cap-events-marking-${Date.now()}.nitpicker`);
	});

	/**
	 * Crawls one page and returns its `content_items.id`.
	 * @param url
	 */
	async function crawlPage(url: string): Promise<number> {
		await archive.setPage({
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		const knex = archive.getKnex();
		const row = (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.where('ur.url', url)
			.select('ci.id as id')
			.first()) as { id: number } | undefined;
		if (!row) {
			throw new Error(`crawlPage: no content_items row for ${url}`);
		}
		return row.id;
	}

	it('tallies captured_page_count from content_items.dedupe_cap_event_id, per event', async () => {
		const eventIdA = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		const eventIdB = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/b/{n}/',
			sampleUrl: 'https://example.com/b/1/',
			bodyHash: Buffer.from('b'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 2000,
		});

		const pageA1 = await crawlPage('https://example.com/a/1/');
		const pageA2 = await crawlPage('https://example.com/a/2/');
		const pageB1 = await crawlPage('https://example.com/b/1/');
		await crawlPage('https://example.com/other/');

		const knex = archive.getKnex();
		await knex('content_items')
			.whereIn('id', [pageA1, pageA2])
			.update({ dedupe_cap_event_id: eventIdA });
		await knex('content_items')
			.where('id', pageB1)
			.update({ dedupe_cap_event_id: eventIdB });

		const result = await listDedupeCapEvents(archive);
		const byId = new Map(result.items.map((item) => [item.id, item]));
		expect(byId.get(eventIdA)?.captured_page_count).toBe(2);
		expect(byId.get(eventIdB)?.captured_page_count).toBe(1);
	});

	it('captured_page_count degrades to 0 when content_items.dedupe_cap_event_id column is absent (pre-feature archive)', async () => {
		const eventId = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		const pageId = await crawlPage('https://example.com/a/1/');
		const knex = archive.getKnex();
		await knex('content_items')
			.where('id', pageId)
			.update({ dedupe_cap_event_id: eventId });

		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('dedupe_cap_event_id');
		});

		const result = await listDedupeCapEvents(archive);
		expect(result.items[0]?.captured_page_count).toBe(0);

		await knex.schema.alterTable('content_items', (t) => {
			t.integer('dedupe_cap_event_id');
		});
	});

	it('sample_url_archived is true when sample_url has a scraped content_items row', async () => {
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		await crawlPage('https://example.com/a/1/');

		const result = await listDedupeCapEvents(archive);
		expect(result.items[0]?.sample_url_archived).toBe(true);
	});

	it('sample_url_archived is false when sample_url was rejected, not crawled', async () => {
		await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/999/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});

		const result = await listDedupeCapEvents(archive);
		expect(result.items[0]?.sample_url_archived).toBe(false);
	});

	it('still computes captured_page_count and sample_url_archived correctly when the event set exceeds the SQLite IN-clause chunk size (500) — regression test for the whereIn chunking branches', async () => {
		const eventId = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/real/{n}/',
			sampleUrl: 'https://example.com/real/1/',
			bodyHash: Buffer.from('real'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 999_999,
		});
		await crawlPage('https://example.com/real/1/');
		const knex = archive.getKnex();
		await knex('content_items')
			.whereIn(
				'url_id',
				knex('url_refs').select('id').where('url', 'https://example.com/real/1/'),
			)
			.update({ dedupe_cap_event_id: eventId });

		// 600 additional events with distinct sample_urls and no captured
		// pages — large enough to force both `countCapturedPagesByEventId`
		// and `findArchivedSampleUrls` past the 500-item `whereIn` chunk
		// boundary. `detectedAt` values are all older than the real event's
		// so it sorts first and stays easy to assert on.
		const decoyRows = Array.from({ length: 600 }, (_, i) => ({
			shape_key: `example.com/decoy-${i}/{n}/`,
			sample_url: `https://example.com/decoy-${i}/1/`,
			body_hash: null,
			effective_threshold: 50,
			observed_count: 100,
			detected_at: i,
			rejected_count: null,
		}));
		await knex.batchInsert('dedupe_cap_events', decoyRows, 100);

		const result = await listDedupeCapEvents(archive, { limit: 700 });
		expect(result.total).toBe(601);
		const realEvent = result.items.find((item) => item.id === eventId);
		expect(realEvent?.captured_page_count).toBe(1);
		expect(realEvent?.sample_url_archived).toBe(true);
	});
});
