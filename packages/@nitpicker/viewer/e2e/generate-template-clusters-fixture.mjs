import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';

const dirname = import.meta.dirname;
const FIXTURE_PATH = path.resolve(dirname, '.fixture-template-clusters.nitpicker');
const FIXTURE_CWD = path.resolve(dirname, '.fixture-template-clusters-tmp');

rmSync(FIXTURE_PATH, { force: true });
rmSync(FIXTURE_CWD, { recursive: true, force: true });
mkdirSync(FIXTURE_CWD, { recursive: true });

const archive = await Archive.create({ filePath: FIXTURE_PATH, cwd: FIXTURE_CWD });
await archive.setConfig({
	baseUrl: 'https://example.com',
	name: 'e2e-template-clusters-fixture',
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
	userAgent: 'e2e',
	ignoreRobots: false,
});

const NO_META = {
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
};

/**
 * Registers one internal, successfully-crawled page with no outbound links.
 * @param url - The page's absolute URL.
 * @param title - The page's `<title>` text.
 */
async function setSimplePage(url, title) {
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
		html: `<html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`,
		meta: { ...NO_META, title },
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
}

// `/blog/` cluster: two pages sharing the same stylesheet set — the CSS-based
// blocking key case (`css:<hash>`), whose heading shows the common
// stylesheet filenames.
await setSimplePage('https://example.com/blog/post-1', 'Blog Post 1');
await setSimplePage('https://example.com/blog/post-2', 'Blog Post 2');
await archive.setResources({
	url: parseUrl('https://example.com/blog.css'),
	isExternal: false,
	isError: false,
	status: 200,
	statusText: 'OK',
	contentType: 'text/css',
	contentLength: 500,
	compress: false,
	cdn: false,
	headers: null,
});
await archive.setResourcesReferrers({
	url: 'https://example.com/blog/post-1',
	src: 'https://example.com/blog.css',
});
await archive.setResourcesReferrers({
	url: 'https://example.com/blog/post-2',
	src: 'https://example.com/blog.css',
});

// `/news/` cluster: two pages with no stylesheet reference at all — the
// path-based blocking key case (`path:<segment>`), whose heading falls back
// to the common directory.
await setSimplePage('https://example.com/news/article-1', 'News Article 1');
await setSimplePage('https://example.com/news/article-2', 'News Article 2');

// `sections` cluster: 7 pages spread across 7 distinct top-level
// directories, one page each — exercises the top-N (5) truncation and the
// "N other pages" remainder in `computeDirectoryDistribution` / the view's
// `otherPageCount`, which the single-directory clusters above cannot.
// Deliberately has no captured reason — covers the `reason === null`
// "not captured" rendering path.
const sectionUrls = [];
for (const section of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
	const url = `https://example.com/section-${section}/page`;
	await setSimplePage(url, `Section ${section}`);
	sectionUrls.push(url);
}

// `/docs/` and `/help/` clusters: sibling final clusters that split off the
// same css blocking group — both carry the identical `distinctiveStylesheetHrefs`
// (`docs.css`), exercising the heading's directory-disambiguation (two
// clusters that would otherwise render an identical "docs.css" heading) and
// the Siblings section's cross-links.
await setSimplePage('https://example.com/docs/guide-1', 'Docs Guide 1');
await setSimplePage('https://example.com/docs/guide-2', 'Docs Guide 2');
await setSimplePage('https://example.com/help/guide-1', 'Help Guide 1');
await archive.setResources({
	url: parseUrl('https://example.com/docs.css'),
	isExternal: false,
	isError: false,
	status: 200,
	statusText: 'OK',
	contentType: 'text/css',
	contentLength: 500,
	compress: false,
	cdn: false,
	headers: null,
});
for (const url of [
	'https://example.com/docs/guide-1',
	'https://example.com/docs/guide-2',
	'https://example.com/help/guide-1',
]) {
	await archive.setResourcesReferrers({ url, src: 'https://example.com/docs.css' });
}

// Cluster-selection reasons: the `/blog/` (css) and `/news/` (path) clusters
// carry a captured reason — one of each `BlockingReason.kind` that yields
// distinctive stylesheets and one that doesn't — while the `sections`
// cluster deliberately has none, covering the `reason === null` "not
// captured" rendering path with a single cluster.
await archive.replacePageTemplates(
	new Map([
		['https://example.com/blog/post-1', '["css:1a2b3c4d5e6f7890","cluster:0"]'],
		['https://example.com/blog/post-2', '["css:1a2b3c4d5e6f7890","cluster:0"]'],
		['https://example.com/news/article-1', '["path:news","cluster:0"]'],
		['https://example.com/news/article-2', '["path:news","cluster:0"]'],
		['https://example.com/docs/guide-1', '["css:9f8e7d6c5b4a3210","cluster:0"]'],
		['https://example.com/docs/guide-2', '["css:9f8e7d6c5b4a3210","cluster:0"]'],
		['https://example.com/help/guide-1', '["css:9f8e7d6c5b4a3210","cluster:1"]'],
		...sectionUrls.map((url) => [url, '["path:sections","cluster:0"]']),
	]),
	new Map([
		[
			'["css:1a2b3c4d5e6f7890","cluster:0"]',
			{
				memberCount: 2,
				blocking: [
					{
						blockKey: '["css:1a2b3c4d5e6f7890"]',
						reason: {
							kind: 'css',
							distinctiveStylesheetHrefs: ['https://example.com/blog.css'],
						},
					},
				],
				structuralCoreTokens: ['body>h1'],
				landmarks: {
					header: {
						presenceRate: 1,
						chromeRate: 1,
						shellTokens: ['header>nav'],
						memberCountWithInstance: 2,
					},
				},
				siblingClusterKeys: [],
			},
		],
		[
			'["path:news","cluster:0"]',
			{
				memberCount: 2,
				blocking: [
					{ blockKey: '["path:news"]', reason: { kind: 'path', pathKey: 'news' } },
				],
				structuralCoreTokens: ['body>h1'],
				landmarks: {},
				siblingClusterKeys: [],
			},
		],
		[
			'["css:9f8e7d6c5b4a3210","cluster:0"]',
			{
				memberCount: 2,
				blocking: [
					{
						blockKey: '["css:9f8e7d6c5b4a3210"]',
						reason: {
							kind: 'css',
							distinctiveStylesheetHrefs: ['https://example.com/docs.css'],
						},
					},
				],
				structuralCoreTokens: ['body>h1'],
				landmarks: {},
				siblingClusterKeys: ['["css:9f8e7d6c5b4a3210","cluster:1"]'],
			},
		],
		[
			'["css:9f8e7d6c5b4a3210","cluster:1"]',
			{
				memberCount: 1,
				blocking: [
					{
						blockKey: '["css:9f8e7d6c5b4a3210"]',
						reason: {
							kind: 'css',
							distinctiveStylesheetHrefs: ['https://example.com/docs.css'],
						},
					},
				],
				structuralCoreTokens: ['body>h1'],
				landmarks: {},
				siblingClusterKeys: ['["css:9f8e7d6c5b4a3210","cluster:0"]'],
			},
		],
	]),
);

// `/api/pages?templateKey=...` (the "view pages in this cluster" link)
// refuses rather than falling back to live when the read model is missing
// (see `refuse-if-stale-read-model.ts`), so this fixture must build one —
// after `replacePageTemplates` above, so the classification it just wrote
// is copied into `viewer_pages.template_key`.
await buildViewerReadModel(archive);

await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E template-clusters fixture created: ${FIXTURE_PATH}`);
