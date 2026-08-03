import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';

const dirname = import.meta.dirname;
const FIXTURE_PATH = path.resolve(dirname, '.fixture-inbound-links.nitpicker');
const FIXTURE_CWD = path.resolve(dirname, '.fixture-inbound-links-tmp');

rmSync(FIXTURE_PATH, { force: true });
rmSync(FIXTURE_CWD, { recursive: true, force: true });
mkdirSync(FIXTURE_CWD, { recursive: true });

const archive = await Archive.create({ filePath: FIXTURE_PATH, cwd: FIXTURE_CWD });
await archive.setConfig({
	baseUrl: 'https://example.com',
	name: 'e2e-inbound-links-fixture',
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
// Must exceed the default MPA `pageSize=100` so the inbound-links list
// paginates (Next button enables, second page has real rows) — mirrors
// `generate-fixture.mjs`'s own `PAGE_COUNT` rationale.
const REFERRER_COUNT = 101;

await archive.setPage({
	url: parseUrl('https://example.com/target'),
	redirectPaths: [],
	isExternal: false,
	isTarget: true,
	status: 200,
	statusText: 'OK',
	contentType: 'text/html',
	contentLength: 200,
	responseHeaders: {},
	html: '<html><head><title>Target</title></head><body><h1>Target</h1></body></html>',
	meta: { ...NO_META, title: 'Target' },
	anchorList: [],
	imageList: [],
	isSkipped: false,
});

// A second target with zero referrers, for the "no inbound links" empty state.
await archive.setPage({
	url: parseUrl('https://example.com/lonely-target'),
	redirectPaths: [],
	isExternal: false,
	isTarget: true,
	status: 200,
	statusText: 'OK',
	contentType: 'text/html',
	contentLength: 200,
	responseHeaders: {},
	html: '<html><head><title>Lonely Target</title></head><body><h1>Lonely Target</h1></body></html>',
	meta: { ...NO_META, title: 'Lonely Target' },
	anchorList: [],
	imageList: [],
	isSkipped: false,
});

for (let i = 0; i < REFERRER_COUNT; i++) {
	const name = `referrer-${i}`;
	await archive.setPage({
		url: parseUrl(`https://example.com/${name}`),
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 200,
		responseHeaders: {},
		html: `<html><head><title>${name}</title></head><body><h1>${name}</h1></body></html>`,
		meta: { ...NO_META, title: name },
		anchorList: [
			{
				href: parseUrl('https://example.com/target'),
				isExternal: false,
				title: null,
				textContent: `Link from ${name}`,
			},
		],
		imageList: [],
		isSkipped: false,
	});
}

// Build the viewer read model before writing — `listInboundLinks` (unlike
// most viewer_*-backed queries) has no live fallback, so `/api/pages/inbound-links`
// would otherwise always respond `{ available: false }` against this
// fixture. Kept in its own fixture (rather than adding this to the shared
// `generate-fixture.mjs`) for the same reason `generate-directory-tree-fixture.mjs`
// is separate: the shared fixture's directory-tree "no read model" empty-state
// test needs the read model to stay unbuilt.
await buildViewerReadModel(archive);

await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E inbound-links fixture created: ${FIXTURE_PATH}`);
