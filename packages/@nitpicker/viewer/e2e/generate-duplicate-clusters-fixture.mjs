import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

const dirname = import.meta.dirname;
const FIXTURE_PATH = path.resolve(dirname, '.fixture-duplicate-clusters.nitpicker');
const FIXTURE_CWD = path.resolve(dirname, '.fixture-duplicate-clusters-tmp');

rmSync(FIXTURE_PATH, { force: true });
rmSync(FIXTURE_CWD, { recursive: true, force: true });
mkdirSync(FIXTURE_CWD, { recursive: true });

const archive = await Archive.create({ filePath: FIXTURE_PATH, cwd: FIXTURE_CWD });
await archive.setConfig({
	baseUrl: 'https://example.com',
	name: 'e2e-duplicate-clusters-fixture',
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

/**
 * Registers one internal, successfully-crawled page — a same-cluster-trap
 * page (identical `<body>`, identical title, `og:url` pointing at a parent
 * listing rather than itself).
 * @param url - The page's absolute URL.
 * @param ogUrl - Absolute `og:url` value to embed (self or parent listing).
 */
async function setTrapPage(url, ogUrl) {
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
		html: '<html><head><title>お知らせ</title></head><body>trap body (identical across every member)</body></html>',
		meta: { title: 'お知らせ', og: { url: ogUrl } },
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
}

// A 12-member same-cluster trap spanning two directories (exercises
// `commonDirectories`' top-N distribution) — 8 members with `og:url`
// pointing at the parent listing (mismatch) and 4 pointing at themselves
// (match), so `ogUrlMismatchRatio` renders as a non-trivial value rather
// than a trivial 0 or 1.
for (let i = 0; i < 8; i++) {
	const url = `https://example.com/news/date/${2015 + i}/`;
	await setTrapPage(url, 'https://example.com/news');
}
for (let i = 0; i < 4; i++) {
	const url = `https://example.com/press/date/${2015 + i}/`;
	await setTrapPage(url, url);
}

const eventId = await archive.insertDedupeCapEvent({
	shapeKey: 'example.com/news/date/{n}/',
	sampleUrl: 'https://example.com/news/date/2022/',
	bodyHash: Buffer.from('trap-body-hash-placeholder'),
	effectiveThreshold: 5,
	observedCount: 8,
	detectedAt: Date.now(),
});
await archive.finalizeDedupeCapEvent(eventId, 42);

await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E duplicate-clusters fixture created: ${FIXTURE_PATH}`);
