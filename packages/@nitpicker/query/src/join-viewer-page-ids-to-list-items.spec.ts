import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { joinViewerPageIdsToListItems } from './join-viewer-page-ids-to-list-items.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: true,
	interval: 0,
	image: true,
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
};

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

describe('joinViewerPageIdsToListItems', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_join_viewer_page_ids_to_list_items__',
	);
	const archiveFilePath = path.resolve(workingDir, 'join-test.nitpicker');
	let archive: InstanceType<typeof Archive>;
	let idA: number;
	let idB: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: { 'content-security-policy': "default-src 'self'" },
			html: '<html></html>',
			meta: { ...META, title: 'A', og: { title: 'OG A' } },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'B' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const rows: { id: number; url: string }[] = await knex('content_items')
			.join('url_refs', 'content_items.url_id', 'url_refs.id')
			.select('content_items.id as id', 'url_refs.url as url');
		idA = rows.find((r) => r.url === 'https://example.com/a')!.id;
		idB = rows.find((r) => r.url === 'https://example.com/b')!.id;

		// Both real call sites (list-viewer-pages.ts, list-directory-pages.ts)
		// require the read model to be current before calling this function
		// — it unconditionally joins `viewer_pages` for
		// displayTitle/inboundLinkCount/dirIndexInboundLinkCount, with no
		// existence guard (see the function's docs for why).
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty array for an empty id list without querying', async () => {
		const knex = archive.getKnex();
		expect(await joinViewerPageIdsToListItems(knex, [])).toEqual([]);
	});

	it('joins ids back to full PageListItem rows, preserving the requested id order (not DB order)', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerPageIdsToListItems(knex, [idB, idA]);
		expect(items.map((i) => i.url)).toEqual([
			'https://example.com/b',
			'https://example.com/a',
		]);
		expect(items[1]).toMatchObject({ title: 'A', ogTitle: 'OG A' });
	});

	it('joins displayTitle/inboundLinkCount/dirIndexInboundLinkCount from viewer_pages', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerPageIdsToListItems(knex, [idA, idB]);
		// Neither page is a directory index, so displayTitle passes the
		// title through unchanged and dirIndexInboundLinkCount stays null —
		// see computeDisplayTitleByPageId/computeDirIndexInboundLinkCountByPageId's
		// docs for the full behavior, exercised there directly.
		expect(items[0]).toMatchObject({ displayTitle: 'A', dirIndexInboundLinkCount: null });
		expect(items[1]).toMatchObject({ displayTitle: 'B', dirIndexInboundLinkCount: null });
		expect(items[0]!.inboundLinkCount).toBe(0);
		expect(items[1]!.inboundLinkCount).toBe(0);
	});

	it('joins protocol/hostname/path1..path10 from viewer_pages', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerPageIdsToListItems(knex, [idA]);
		expect(items[0]).toMatchObject({
			protocol: 'https:',
			hostname: 'example.com',
			path1: '/a',
			path2: null,
		});
	});

	it('computes header-presence flags on the joined row, not just the write-model columns', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerPageIdsToListItems(knex, [idA, idB]);
		expect(items[0]).toMatchObject({
			hasCSP: true,
			hasXFrameOptions: false,
			hasXContentTypeOptions: false,
			hasHSTS: false,
		});
		expect(items[1]).toMatchObject({ hasCSP: false });
	});

	it('does not throw and returns templateKey: null when page_templates does not exist (archive predating --templates, or a read-only connection that skipped self-heal)', async () => {
		const knex = archive.getKnex();
		await knex.schema.dropTable('page_templates');
		const items = await joinViewerPageIdsToListItems(knex, [idA, idB]);
		expect(items.map((i) => i.templateKey)).toEqual([null, null]);
	});

	it('re-derives isDedupeCapped from the live content_items column, not a stale read-model snapshot', async () => {
		const knex = archive.getKnex();
		const eventId = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/a',
			sampleUrl: 'https://example.com/a',
			bodyHash: Buffer.from('test-body-hash'),
			effectiveThreshold: 5,
			observedCount: 5,
			detectedAt: 1_700_000_000_000,
		});
		await knex('content_items').where('id', idA).update({ dedupe_cap_event_id: eventId });

		const items = await joinViewerPageIdsToListItems(knex, [idA, idB]);
		expect(items[0]).toMatchObject({
			url: 'https://example.com/a',
			isDedupeCapped: true,
		});
		expect(items[1]).toMatchObject({
			url: 'https://example.com/b',
			isDedupeCapped: false,
		});
	});
});
