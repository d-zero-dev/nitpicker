import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSummary } from './get-summary.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures__');

describe('getSummary', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'summary-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com', 'https://example.com/blog/'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 1000,
			responseHeaders: {},
			html: '<html><head><title>Home</title></head><body></body></html>',
			meta: {
				lang: 'ja',
				title: 'Home',
				description: 'Test description',
				keywords: 'test',
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: null,
				alternate: null,
				'og:type': null,
				'og:title': 'Home',
				'og:site_name': null,
				'og:description': null,
				'og:url': null,
				'og:image': null,
				'twitter:card': null,
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 500,
			responseHeaders: {},
			html: '<html><head><title>About</title></head><body></body></html>',
			meta: {
				lang: 'ja',
				title: 'About',
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// 403, not 404: unlike a 404 (excluded from every total — see the
		// dedicated "404 exclusion" describe below), a 403 page exists and
		// must keep counting, which is exactly the legacy counting path this
		// fixture pins: an errored-but-existing HTML page counts as a page,
		// shows in the histogram, and stays in the metadata denominator.
		await archive.setPage({
			url: parseUrl('https://example.com/403')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 403,
			statusText: 'Forbidden',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><body>Not Found</body></html>',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// In-scope non-HTML resource (PDF): isTarget=1 but NOT a page. It must not
		// inflate totalPages/internalPages and must not dilute the metadata rates.
		await archive.setPage({
			url: parseUrl('https://example.com/doc.pdf')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 2048,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		/* Two external rows: one HTML page (counts toward both externalPages
		   and externalContents) and one PDF (only counts toward
		   externalContents, since externalPages still filters by the
		   HTML-or-null base predicate). Together they pin the difference
		   the new card shows. */
		await archive.setPage({
			url: parseUrl('https://other.example/page')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 256,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://other.example/spec.pdf')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 512,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Errored / unreachable internal page: scraped=1 but contentType=null. It IS
		// a page (counted, and its status shows in the histogram) but it can never
		// carry metadata, so it must NOT be in the metadata-fulfillment denominator.
		await archive.setPage({
			url: parseUrl('https://example.com/broken')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: -1,
			statusText: 'ERR_NAME_NOT_RESOLVED',
			contentType: null,
			contentLength: null,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('サイト概況を正しく返す', async () => {
		const result = await getSummary(archive);

		expect(result.baseUrl).toBe('https://example.com');
		expect(result.roots).toEqual(['https://example.com', 'https://example.com/blog/']);
		/* Page-shaped counts (HTML-or-null filter): 3 internal HTML +
		   1 errored (null contentType) + 1 external HTML = 5. The internal
		   PDF and the external PDF are both excluded by the filter. */
		expect(result.totalPages).toBe(5);
		expect(result.internalPages).toBe(4);
		expect(result.externalPages).toBe(1);
		// The errored page's status IS in the histogram (broken-link audit needs it).
		// The `-1` row now carries an `errorKindBreakdown` summing to its `count`,
		// so we match `count`/`status` with `objectContaining` and assert the
		// breakdown invariant separately rather than re-spelling it inline.
		const minusOne = result.statusDistribution.find((e) => e.status === -1);
		expect(minusOne).toBeDefined();
		expect(minusOne!.count).toBe(1);
		const breakdownSum = (minusOne!.errorKindBreakdown ?? []).reduce(
			(acc, e) => acc + e.count,
			0,
		);
		expect(breakdownSum).toBe(minusOne!.count);
		/* 200 = 2 internal HTML + 1 external HTML. The PDFs are excluded by
		   the same HTML-or-null filter, so adding the external PDF doesn't
		   bump this. */
		expect(result.statusDistribution).toContainEqual({ status: 200, count: 3 });
		expect(result.statusDistribution).toContainEqual({ status: 403, count: 1 });
		// Metadata denominator stays 3 (HTML pages only): neither the PDF nor the
		// errored page dilutes it (otherwise title would be 2/4 or 2/5).
		expect(result.metadataFulfillment.title).toBeCloseTo(2 / 3);
		expect(result.metadataFulfillment.description).toBeCloseTo(1 / 3);

		/* Content-Type distribution covers EVERY in-scope row regardless of
		   MIME, so HTML (3 internal + 1 external), PDF (1 internal +
		   1 external) and unknown/errored (1 internal) all show up. The
		   external PDF being on its own external bucket is what proves the
		   externalContents > externalPages relationship below. */
		expect(result.contentTypeDistribution).toContainEqual({
			category: 'html',
			internal: 3,
			external: 1,
		});
		expect(result.contentTypeDistribution).toContainEqual({
			category: 'pdf',
			internal: 1,
			external: 1,
		});
		expect(result.contentTypeDistribution).toContainEqual({
			category: 'unknown',
			internal: 1,
			external: 0,
		});
		// Sorted by total count descending — HTML (4) must come first.
		expect(result.contentTypeDistribution[0]?.category).toBe('html');

		/* internalContents covers every in-scope internal row regardless of
		   MIME: 3 HTML + 1 PDF + 1 errored = 5. internalPages stays at the
		   HTML count = 4 (errored row's null contentType passes the
		   HTML-or-null filter). externalContents = 1 external HTML +
		   1 external PDF = 2, while externalPages = 1 (only the HTML row
		   passes the filter). Together the two ratios prove the
		   "internal pages ≤ internal contents" and
		   "external pages ≤ external contents" invariants the JSDoc
		   on `SummaryResult` promises. */
		expect(result.internalContents).toBe(5);
		expect(result.externalContents).toBe(2);
		expect(result.internalContents).toBeGreaterThanOrEqual(result.internalPages);
		expect(result.externalContents).toBeGreaterThanOrEqual(result.externalPages);
	});
});

describe('getSummary: 404 exclusion', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_summary_404_exclusion__');
	const archiveFilePath = path.resolve(dir, 'summary-404-exclusion.nitpicker');

	/**
	 * Insert an HTML page with the minimal meta shape `setPage` requires.
	 * @param params - The page's varying fields.
	 * @param params.url - The page URL.
	 * @param params.status - The HTTP status.
	 * @param params.isExternal - Whether the page is external.
	 * @param params.title - The page title, or `null` for none.
	 */
	async function insertHtmlPage(params: {
		url: string;
		status: number;
		isExternal: boolean;
		title: string | null;
	}): Promise<void> {
		await archive.setPage({
			url: parseUrl(params.url)!,
			redirectPaths: [],
			isExternal: params.isExternal,
			isTarget: !params.isExternal,
			status: params.status,
			statusText: params.status === 200 ? 'OK' : 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: `<html><head><title>${params.title ?? ''}</title></head><body></body></html>`,
			meta: {
				lang: null,
				title: params.title,
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		await insertHtmlPage({
			url: 'https://example.com/',
			status: 200,
			isExternal: false,
			title: 'Home',
		});
		// Fix-target 404s (source stays `setPage`'s default `'crawled'`):
		// one internal, one external — both must vanish from every total
		// while merging into the single plain 404 histogram row.
		await insertHtmlPage({
			url: 'https://example.com/gone',
			status: 404,
			isExternal: false,
			title: null,
		});
		await insertHtmlPage({
			url: 'https://other.example/dead',
			status: 404,
			isExternal: true,
			title: null,
		});
		// An inventory-seed 404 (an input mistake — the URL came from a
		// `crawl --inventory` list and never existed). Relabelled directly
		// (same precedent as the alias_of_id describe above): `setPage`
		// always writes `'crawled'`, and going through the full
		// `--inventory` orchestration here would drown the fixture in
		// unrelated setup.
		await insertHtmlPage({
			url: 'https://example.com/ghost',
			status: 404,
			isExternal: false,
			title: null,
		});
		const knex = archive.getKnex();
		await knex('content_items')
			.whereIn('url_id', (qb) => {
				qb.select('id').from('url_refs').where('url', 'https://example.com/ghost');
			})
			.update({ source: 'inventory-seed' });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('excludes every 404 from page/content totals regardless of provenance', async () => {
		const result = await getSummary(archive);
		// Only the 200 home page counts — /gone (crawled), /ghost
		// (inventory-seed) and the external /dead are all 404s.
		expect(result.totalPages).toBe(1);
		expect(result.internalPages).toBe(1);
		expect(result.externalPages).toBe(0);
		expect(result.internalContents).toBe(1);
		expect(result.externalContents).toBe(0);
		expect(result.contentTypeDistribution).toEqual([
			{ category: 'html', internal: 1, external: 0 },
		]);
	});

	it('splits the 404 histogram row by provenance, trailing the inventory-seed row last', async () => {
		const result = await getSummary(archive);
		// The plain row merges the two fix-target 404s (internal + external);
		// `toContainEqual` is exact-equality per element, so the two-field
		// literal can only match the plain row — the seed row carries the
		// extra `inventorySeed: true`.
		expect(result.statusDistribution).toContainEqual({ status: 404, count: 2 });
		expect(result.statusDistribution.at(-1)).toEqual({
			status: 404,
			count: 1,
			inventorySeed: true,
		});
	});

	it('keeps fix-target 404s in the metadata denominator but drops inventory-seed 404s', async () => {
		const result = await getSummary(archive);
		// Denominator = home + /gone (a fix-target page still owes its
		// metadata) = 2; /ghost is an input mistake and leaves. Only home
		// has a title: 1/2. An all-404 exclusion would read 1/1 and a
		// no-exclusion would read 1/3 — 1/2 pins the asymmetric rule.
		expect(result.metadataFulfillment.title).toBeCloseTo(1 / 2);
	});
});

describe('getSummary: statusDistribution ordering with a null-status legacy row', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_summary_null_status_order__');
	const archiveFilePath = path.resolve(dir, 'summary-null-status-order.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		for (const page of [
			{ url: 'https://example.com/', status: 200 },
			{ url: 'https://example.com/ghost', status: 404 },
		]) {
			await archive.setPage({
				url: parseUrl(page.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: page.status,
				statusText: page.status === 200 ? 'OK' : 'Not Found',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: {
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
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
		const knex = archive.getKnex();
		await knex('content_items')
			.whereIn('url_id', (qb) => {
				qb.select('id').from('url_refs').where('url', 'https://example.com/ghost');
			})
			.update({ source: 'inventory-seed' });
		// A raw legacy-shaped row with NO status (and no content type):
		// `setPage` cannot produce one, so insert directly — the same
		// technique build-viewer-read-model.spec uses for its unparseable-URL
		// row.
		const [urlRef] = await knex('url_refs')
			.insert({ url: 'https://example.com/legacy-null' })
			.returning('id');
		await knex('content_items').insert({
			url_id: urlRef.id,
			scraped: 1,
			is_target: 1,
			is_external: 0,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('orders rows: numeric statuses, then the inventory-seed 404, then the null trailer', async () => {
		const result = await getSummary(archive);
		expect(result.statusDistribution).toEqual([
			{ status: 200, count: 1 },
			{ status: 404, count: 1, inventorySeed: true },
			{ status: null, count: 1 },
		]);
	});
});

describe('getSummary: HTMLページが1つも無い（全てエラー/到達不能）アーカイブ', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_summary_no_html__');
	const archiveFilePath = path.resolve(dir, 'summary-no-html.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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
		// Only an errored/unreachable internal page — zero text/html rows.
		await archive.setPage({
			url: parseUrl('https://example.com/broken')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: -1,
			statusText: 'ERR_NAME_NOT_RESOLVED',
			contentType: null,
			contentLength: null,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('メタ充足率の分母が 0 でも NaN にならず 0 を返す', async () => {
		const result = await getSummary(archive);
		// The errored page is still counted as a page...
		expect(result.totalPages).toBe(1);
		// ...but with zero text/html rows the metadata denominator is 0; the guard
		// must yield 0, not NaN (0/0). Removing the `metaTotal > 0` guard makes these NaN.
		expect(result.metadataFulfillment.title).toBe(0);
		expect(result.metadataFulfillment.description).toBe(0);
		expect(result.metadataFulfillment.ogImage).toBe(0);
	});

	it('internalContents / externalContents は 0 件アーカイブでも 0 を返す', async () => {
		const result = await getSummary(archive);
		/* The fixture has exactly one internal errored row (null contentType,
		   status = -1). The content totals must include it (they don't filter
		   by MIME) — that's the key difference from internalPages, which the
		   HTML-or-null filter would keep at 1 as well in this edge case. */
		expect(result.internalContents).toBe(1);
		expect(result.externalContents).toBe(0);
	});
});

describe('getSummary: content_items.alias_of_id handling', () => {
	const dir = path.resolve(__dirname, '__test_fixtures_summary_alias__');
	const archiveFilePath = path.resolve(dir, 'summary-alias-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		for (const url of ['https://example.com/', 'https://example.com/index.html']) {
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
				html: '<html><body>Home</body></html>',
				meta: {
					lang: 'ja',
					title: 'Home',
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
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		// Simulate an alias assignment (as backfillAliasOfId would compute):
		// `/index.html` merged into the bare root. The crawler's own URL
		// handling normalizes a bare-root trailing slash away at write time
		// (`https://example.com/` is stored as `https://example.com`), so the
		// lookup below matches on the slash-less form actually stored.
		const knex = archive.getKnex();
		const target = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com')
			.first();
		const member = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/index.html')
			.first();
		await knex('content_items').where('id', member.id).update({ alias_of_id: target.id });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('counts an alias-merged page as one page, not two', async () => {
		const result = await getSummary(archive);
		expect(result.totalPages).toBe(1);
		expect(result.internalPages).toBe(1);
	});

	it('throws an actionable error when content_items.alias_of_id does not exist', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('alias_of_id');
		});

		await expect(getSummary(archive)).rejects.toThrow(/viewer-build/);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('alias_of_id');
		});
	});
});

describe('getSummary: network-outage attribution', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_summary_outage_attribution__');
	const archiveFilePath = path.resolve(dir, 'summary-outage-attribution.nitpicker');

	/**
	 * Insert a status=-1 page with the minimal meta shape `setPage` requires.
	 * @param url - The failed page's URL.
	 */
	async function insertFailedPage(url: string): Promise<void> {
		await archive.setPage({
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: -1,
			statusText: 'ERR_NAME_NOT_RESOLVED',
			contentType: null,
			contentLength: null,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		await insertFailedPage('https://example.com/outage-caused');
		await insertFailedPage('https://example.com/genuinely-gone');

		const knex = archive.getKnex();
		await knex('crawl_errors').insert([
			{
				url: 'https://example.com/outage-caused',
				isExternal: 0,
				message: 'getaddrinfo ENOTFOUND outage-caused.example',
				createdAt: 1_000_150,
			},
			{
				url: 'https://example.com/genuinely-gone',
				isExternal: 0,
				message: 'getaddrinfo ENOTFOUND genuinely-gone.example',
				createdAt: 500,
			},
		]);

		const outageId = await archive.insertNetworkOutage({
			startedAt: 1_000_100,
			detectedAt: 1_000_120,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await archive.closeNetworkOutage(outageId, 1_000_200);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('splits the dns bucket by attribution: one network-caused, one site-caused', async () => {
		const result = await getSummary(archive);
		const minusOne = result.statusDistribution.find((e) => e.status === -1);
		expect(minusOne?.count).toBe(2);

		const breakdown = minusOne?.errorKindBreakdown ?? [];
		expect(breakdown).toContainEqual({ kind: 'dns', attribution: 'network', count: 1 });
		expect(breakdown).toContainEqual({ kind: 'dns', attribution: 'site', count: 1 });
	});

	it('counts networkOutageAffectedFailures as exactly the network-attributed failures', async () => {
		const result = await getSummary(archive);
		expect(result.networkOutageAffectedFailures).toBe(1);
	});
});

describe('getSummary: no recorded outages behaves identically to before this feature', () => {
	it('reports networkOutageAffectedFailures as 0 when network_outages has no rows', async () => {
		const dir = path.resolve(__dirname, '__test_fixtures_summary_no_outages__');
		const archiveFilePath = path.resolve(dir, 'summary-no-outages.nitpicker');
		const { mkdirSync, rmSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		const result = await getSummary(archive);
		expect(result.networkOutageAffectedFailures).toBe(0);

		await archive.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('getSummary: console log counts (issue #228)', () => {
	it('reports total occurrence counts for pageerror/error/warn, excluding other types', async () => {
		const dir = path.resolve(__dirname, '__test_fixtures_summary_console_logs__');
		const archiveFilePath = path.resolve(dir, 'summary-console-logs.nitpicker');
		const { mkdirSync, rmSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		await archive.setConsoleLogs(
			'https://example.com/a',
			[],
			[
				{ pageUrl: 'https://example.com/a', type: 'error', text: 'e', args: [], ts: 1 },
				{ pageUrl: 'https://example.com/a', type: 'warn', text: 'w', args: [], ts: 2 },
				{ pageUrl: 'https://example.com/a', type: 'log', text: 'l', args: [], ts: 3 },
				{
					pageUrl: 'https://example.com/a',
					type: 'pageerror',
					text: 'p',
					args: [],
					ts: 4,
				},
			],
		);

		const result = await getSummary(archive);
		expect(result.consoleLogCounts).toEqual({ pageerror: 1, error: 1, warn: 1 });

		await archive.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('reports all-zero counts when no console logs were captured', async () => {
		const dir = path.resolve(__dirname, '__test_fixtures_summary_no_console_logs__');
		const archiveFilePath = path.resolve(dir, 'summary-no-console-logs.nitpicker');
		const { mkdirSync, rmSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		const result = await getSummary(archive);
		expect(result.consoleLogCounts).toEqual({ pageerror: 0, error: 0, warn: 0 });

		await archive.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('getSummary: exclude settings (issue #261)', () => {
	it('passes through excludes/excludeKeywords/excludeUrls/maxExcludedDepth from config', async () => {
		const dir = path.resolve(__dirname, '__test_fixtures_summary_excludes__');
		const archiveFilePath = path.resolve(dir, 'summary-excludes.nitpicker');
		const { mkdirSync, rmSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			excludes: ['/admin/*'],
			excludeKeywords: ['draft'],
			excludeUrls: ['https://example.com/temp'],
			maxExcludedDepth: 3,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		const result = await getSummary(archive);
		expect(result.excludes).toEqual(['/admin/*']);
		expect(result.excludeKeywords).toEqual(['draft']);
		expect(result.excludeUrls).toEqual(['https://example.com/temp']);
		expect(result.maxExcludedDepth).toBe(3);

		await archive.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
