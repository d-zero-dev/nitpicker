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
			version: '0.10.0',
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

		await archive.setPage({
			url: parseUrl('https://example.com/404')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
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
		expect(result.statusDistribution).toContainEqual({ status: 404, count: 1 });
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
			version: '0.10.0',
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
