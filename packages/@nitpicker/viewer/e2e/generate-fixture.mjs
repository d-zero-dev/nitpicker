import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';

const dirname = import.meta.dirname;
const FIXTURE_PATH = path.resolve(dirname, '.fixture.nitpicker');
const FIXTURE_CWD = path.resolve(dirname, '.fixture-tmp');
// Must exceed the default MPA `pageSize=100` so the fixture paginates (Next
// button enables, `?page=2` lands on the second page). Smaller fixtures
// collapse to one page and the pagination smoke tests can't actually
// observe a page-change event.
const PAGE_COUNT = 120;

rmSync(FIXTURE_PATH, { force: true });
rmSync(FIXTURE_CWD, { recursive: true, force: true });
mkdirSync(FIXTURE_CWD, { recursive: true });

const archive = await Archive.create({ filePath: FIXTURE_PATH, cwd: FIXTURE_CWD });
await archive.setConfig({
	baseUrl: 'https://example.com',
	name: 'e2e-fixture',
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
	userAgent: 'e2e',
	ignoreRobots: false,
});

for (let i = 0; i < PAGE_COUNT; i++) {
	const url = i === 0 ? 'https://example.com/' : `https://example.com/page-${i}`;
	await archive.setPage({
		url: parseUrl(url),
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 200,
		responseHeaders: {},
		html: `<html><head><title>Page ${i}</title></head><body><h1>Page ${i}</h1></body></html>`,
		// Only the first page carries main-content data — the pagination smoke
		// tests don't care, and this keeps the fixture-generation loop cheap.
		mainContents:
			i === 0
				? {
						title: `Page ${i}`,
						main: {
							nodeName: 'MAIN',
							id: null,
							classList: ['l-main'],
							role: null,
							selector: 'main.l-main',
						},
						wordCount: 100,
						bodyWordCount: 150,
						headings: [{ text: 'Page 0', level: 1 }],
						images: [],
						tables: [],
						buttons: [],
						iframes: [],
						videos: [],
						audios: [],
						canvases: [],
					}
				: null,
		scrollHeight: i === 0 ? { desktop: 3200, mobile: 5400 } : null,
		meta: {
			lang: 'ja',
			title: `Page ${i}`,
			description: `Description for page ${i}`,
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
		anchorList:
			i === 0
				? [
						...Array.from({ length: PAGE_COUNT - 1 }, (_, j) => ({
							href: parseUrl(`https://example.com/page-${j + 1}`),
							isExternal: false,
							title: null,
							textContent: `Page ${j + 1}`,
						})),
						{
							href: parseUrl('https://example.com/broken-page'),
							isExternal: false,
							title: null,
							textContent: 'Broken page',
						},
						{
							href: parseUrl('https://external.example.com/'),
							isExternal: true,
							title: null,
							textContent: 'External site',
						},
					]
				: i < PAGE_COUNT - 1
					? [
							{
								href: parseUrl(`https://example.com/page-${i + 1}`),
								isExternal: false,
								title: null,
								textContent: 'Next',
							},
							// A second internal referrer to the same external
							// destination as page 0, so the External Links
							// view's dedup + referrerCount is exercised
							// meaningfully (2 referrers, not 1).
							...(i === 1
								? [
										{
											href: parseUrl('https://external.example.com/'),
											isExternal: true,
											title: null,
											textContent: 'External site (again)',
										},
									]
								: []),
						]
					: [],
		imageList: [],
		isSkipped: false,
	});
}

// A 404 page and an external page so the Broken Links / External Links views
// (and shared DataTable smoke tests that point at them) have non-empty data.
await archive.setPage({
	url: parseUrl('https://example.com/broken-page'),
	redirectPaths: [],
	isExternal: false,
	isTarget: true,
	status: 404,
	statusText: 'Not Found',
	contentType: 'text/html',
	contentLength: 0,
	responseHeaders: {},
	html: '',
	meta: {
		lang: 'ja',
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
	url: parseUrl('https://external.example.com/'),
	redirectPaths: [],
	isExternal: true,
	isTarget: false,
	status: 200,
	statusText: 'OK',
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

// `/api/pages` and its siblings refuse rather than silently degrading to
// live when the read model is missing (see `refuse-if-stale-read-model.ts`),
// so this fixture must build one to reflect the real crawl → viewer-build →
// viewer flow. The "no read model" empty state has its own dedicated
// coverage against `generate-stub-fixture.mjs` in `viewer-stub.spec.ts`,
// which genuinely can never have a read model (a live crawl in progress).
await buildViewerReadModel(archive);

await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E fixture created: ${FIXTURE_PATH}`);
