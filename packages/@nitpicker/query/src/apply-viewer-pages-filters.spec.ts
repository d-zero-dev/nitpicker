import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyViewerPagesFilters } from './apply-viewer-pages-filters.js';
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

describe('applyViewerPagesFilters', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters__',
	);
	const archiveFilePath = path.resolve(workingDir, 'apply-filters-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/html-internal')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/doc.pdf')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('defaults to the html/unknown content_category restriction when no category filter is given', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, {});
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/html-internal']);
	});

	it('relaxes the default restriction when an explicit contentTypeCategory is given', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { contentTypeCategory: 'pdf' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/doc.pdf']);
	});

	it('filters by an array of contentTypeCategory values, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { contentTypeCategory: ['html', 'pdf'] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/doc.pdf',
			'https://example.com/html-internal',
		]);
	});

	it('defaults to the html/unknown content_category restriction when contentTypeCategory is an empty array — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { contentTypeCategory: [] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/html-internal']);
	});

	it('filters by an array of statuses, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { status: [200, 999] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/html-internal',
		]);
	});
});

describe('applyViewerPagesFilters — templateKey', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters_template_key__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-filters-template-key-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		for (const pagePath of ['/a', '/b', '/c']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pagePath}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
		await archive.replacePageTemplates(
			new Map([
				['https://example.com/a', 'template-a'],
				['https://example.com/b', 'template-b'],
				['https://example.com/c', 'template-c'],
			]),
			new Map(),
		);

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('filters by an array of templateKey values, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { templateKey: ['template-a', 'template-c'] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/a',
			'https://example.com/c',
		]);
	});

	it('applies no templateKey restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { templateKey: [] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/c',
		]);
	});
});

describe('applyViewerPagesFilters — isDedupeCapped', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters_dedupe_cap__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-filters-dedupe-cap-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let eventId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		for (const url of ['https://example.com/capped', 'https://example.com/not-capped']) {
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
				html: '<html></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		eventId = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/capped',
			sampleUrl: 'https://example.com/capped',
			bodyHash: Buffer.from('test-body-hash'),
			effectiveThreshold: 8,
			observedCount: 8,
			detectedAt: 1_700_000_000_000,
		});
		const knex = archive.getKnex();
		// A plain `.join().update()` chain silently drops the JOIN when
		// compiled for SQLite (knex has no UPDATE...JOIN support for this
		// dialect), producing invalid SQL that references the joined
		// alias with no FROM/JOIN clause to back it. A `whereIn` subquery
		// avoids the join entirely.
		await knex('content_items')
			.whereIn(
				'url_id',
				knex('url_refs').select('id').where('url', 'https://example.com/capped'),
			)
			.update({ dedupe_cap_event_id: eventId });

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('filters to only the marked page when isDedupeCapped is true', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { isDedupeCapped: true });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/capped']);
	});

	it('filters to only the unmarked page when isDedupeCapped is false', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { isDedupeCapped: false });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/not-capped']);
	});

	it('applies no restriction when isDedupeCapped is an array of both values — OR-equivalent to no filter', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { isDedupeCapped: [true, false] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/capped',
			'https://example.com/not-capped',
		]);
	});

	it('filters to only the page captured by the matching dedupeCapEventId', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { dedupeCapEventId: eventId });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/capped']);
	});

	it('returns zero rows for a non-matching dedupeCapEventId', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { dedupeCapEventId: eventId + 999 });
		const rows = await qb.select('url');
		expect(rows).toEqual([]);
	});
});

describe('applyViewerPagesFilters — lang and header presence', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters_lang_headers__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-filters-lang-headers-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/ja-with-csp')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {
				'content-security-policy': "default-src 'self'",
				'strict-transport-security': 'max-age=31536000',
			},
			html: '<html></html>',
			meta: { ...META, lang: 'ja', title: 'JA' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/en-no-headers')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, lang: 'en', title: 'EN' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://cdn.example.net/fr-external-missing-title')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, lang: 'fr', title: null },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('filters by exact lang', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { lang: 'ja' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/ja-with-csp']);
	});

	it('filters by header presence (hasCSP: true)', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { hasCSP: true });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/ja-with-csp']);
	});

	it('filters by header absence (hasCSP: false), including pages with no headers at all', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { hasCSP: false });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://cdn.example.net/fr-external-missing-title',
			'https://example.com/en-no-headers',
		]);
	});

	it('combines multiple header-presence filters (hasHSTS present, hasXFrameOptions absent)', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { hasHSTS: true, hasXFrameOptions: false });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/ja-with-csp']);
	});

	it('filters by an array of lang values, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { lang: ['ja', 'fr'] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://cdn.example.net/fr-external-missing-title',
			'https://example.com/ja-with-csp',
		]);
	});

	it('applies no lang restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { lang: [] });
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('filters to external pages only when isExternal is true', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { isExternal: true });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual([
			'https://cdn.example.net/fr-external-missing-title',
		]);
	});

	it('applies no restriction when isExternal is both true and false, OR-ed together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { isExternal: [true, false] });
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('applies no isExternal restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { isExternal: [] });
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('filters to pages missing title only when missingTitle is true', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { missingTitle: true });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual([
			'https://cdn.example.net/fr-external-missing-title',
		]);
	});

	it('filters to pages with a title only when missingTitle is false', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { missingTitle: false });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/en-no-headers',
			'https://example.com/ja-with-csp',
		]);
	});

	it('applies no restriction when missingTitle is both true and false, OR-ed together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { missingTitle: [true, false] });
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('applies no missingTitle restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { missingTitle: [] });
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('filters by an array of header-presence values, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { hasCSP: [true, false] });
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('applies no hasCSP restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { hasCSP: [] });
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});
});

describe('applyViewerPagesFilters — urlPattern', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters_url_pattern__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-filters-url-pattern-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/about-us')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><head><title>About</title></head></html>',
			meta: { ...META, title: 'About' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/target')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><head><title>Target</title></head></html>',
			meta: { ...META, title: 'Target' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/old-location')!,
			redirectPaths: ['https://example.com/target'],
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('matches the canonical URL with a plain LIKE', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { urlPattern: '%about%' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/about-us']);
	});

	it('surfaces the canonical row when the pattern matches only a redirect-source URL — parity with listPages', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { urlPattern: '%old-location%' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/target']);
	});

	it('matches nothing for a pattern that hits neither canonical nor equivalent URLs', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { urlPattern: '%no-such-page%' });
		const rows = await qb.select('url');
		expect(rows).toEqual([]);
	});
});

describe('applyViewerPagesFilters — directory', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters_directory__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-filters-directory-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		const pagePaths = [
			'/blog/2024/post-a',
			'/blog/2024/sub/post-b',
			// A sibling directory sharing `/blog` as a literal string prefix —
			// must NOT be matched by a `directory: '/blog/2024'` filter.
			'/blog2/post-c',
		];
		for (const pagePath of pagePaths) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pagePath}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('matches a directory and its entire subtree, not a literal-prefix sibling', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { directory: '/blog/2024' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/blog/2024/post-a',
			'https://example.com/blog/2024/sub/post-b',
		]);
	});

	it('treats a directory with or without a trailing slash the same', async () => {
		const knex = archive.getKnex();
		const qbNoSlash = knex('viewer_pages');
		applyViewerPagesFilters(qbNoSlash, { directory: '/blog/2024' });
		const qbWithSlash = knex('viewer_pages');
		applyViewerPagesFilters(qbWithSlash, { directory: '/blog/2024/' });

		const [rowsNoSlash, rowsWithSlash] = await Promise.all([
			qbNoSlash.select('url'),
			qbWithSlash.select('url'),
		]);
		expect(rowsNoSlash.map((r) => r.url).toSorted()).toEqual(
			rowsWithSlash.map((r) => r.url).toSorted(),
		);
	});
});
