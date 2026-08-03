import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';

const dirname = import.meta.dirname;
const FIXTURE_PATH = path.resolve(dirname, '.fixture-directory-tree.nitpicker');
const FIXTURE_CWD = path.resolve(dirname, '.fixture-directory-tree-tmp');
// Must exceed the viewer's PAGE_SIZE (100) so the directory pages panel's
// infinite-scroll pagination has a second page to load.
const DOCS_PAGE_COUNT = 120;

rmSync(FIXTURE_PATH, { force: true });
rmSync(FIXTURE_CWD, { recursive: true, force: true });
mkdirSync(FIXTURE_CWD, { recursive: true });

const archive = await Archive.create({ filePath: FIXTURE_PATH, cwd: FIXTURE_CWD });
await archive.setConfig({
	baseUrl: 'https://example.com',
	name: 'e2e-directory-tree-fixture',
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
 * Registers one internal, successfully-crawled page with no outbound links —
 * the directory tree read model only needs each page's URL, not its link
 * graph.
 * @param url - The page's absolute URL.
 * @param title - The page's `<title>` text.
 * @param contentType - The response's raw Content-Type. Defaults to
 *   `text/html`; pass e.g. `image/jpeg` to register a non-page resource.
 */
async function setSimplePage(url, title, contentType = 'text/html') {
	await archive.setPage({
		url: parseUrl(url),
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType,
		contentLength: 200,
		responseHeaders: {},
		html:
			contentType === 'text/html'
				? `<html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`
				: '',
		meta: { ...NO_META, title },
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
}

// Root index page — the tree's depth-0 node.
await setSimplePage('https://example.com/', 'Home');

// `/docs/` (depth 1): many direct pages, so the pages panel's infinite
// scroll has a second page to load, plus one child directory (`guide/`).
for (let i = 0; i < DOCS_PAGE_COUNT; i++) {
	await setSimplePage(`https://example.com/docs/page-${i}`, `Docs Page ${i}`);
}
// `/docs/guide/` (depth 2): a leaf directory (no child directories) —
// exercises "no expand arrow on a node with hasChildren: false".
await setSimplePage('https://example.com/docs/guide/setup', 'Guide Setup');

// `/blog/2023/07/` (depth 3): the initial payload's cutoff. It has both a
// direct page (`report`) and a child directory (`22/`, depth 4) that is
// absent from the initial `/api/directory-tree` payload and must be fetched
// dynamically via `/api/directory-tree/children` — the boundary-node case.
// Also has a direct non-HTML resource (`banner.jpg`) — this node's
// directPageCount/descendantPageCount count it, but directHtmlPageCount/
// descendantHtmlPageCount (what the tree UI's badge shows) must not.
await setSimplePage('https://example.com/blog/2023/07/report', 'July Report');
await setSimplePage(
	'https://example.com/blog/2023/07/banner.jpg',
	'Banner',
	'image/jpeg',
);
// `/blog/2023/07/22/` (depth 4): reached only through the dynamic fetch
// above; itself a leaf directory (no further child directories).
await setSimplePage('https://example.com/blog/2023/07/22/post-a', 'Post A');

// Build the viewer read model before writing — directory-tree's 3 query
// functions (get-directory-tree.ts et al.) are gated on
// `isViewerReadModelCurrent`, not `hasViewerReadModel`, and have no live
// fallback, so `/api/directory-tree` would otherwise always return an empty
// `{ roots: [] }` against this fixture (see `ensure-viewer-read-model-quietly.ts`
// for the same call in the crawl-completion path).
await buildViewerReadModel(archive);

await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E directory-tree fixture created: ${FIXTURE_PATH}`);
