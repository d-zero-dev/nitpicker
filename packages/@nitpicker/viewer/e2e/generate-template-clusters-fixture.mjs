import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

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

await archive.replacePageTemplates(
	new Map([
		['https://example.com/blog/post-1', '["css:1a2b3c4d5e6f7890","cluster:0"]'],
		['https://example.com/blog/post-2', '["css:1a2b3c4d5e6f7890","cluster:0"]'],
		['https://example.com/news/article-1', '["path:news","cluster:0"]'],
		['https://example.com/news/article-2', '["path:news","cluster:0"]'],
	]),
);

await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E template-clusters fixture created: ${FIXTURE_PATH}`);
