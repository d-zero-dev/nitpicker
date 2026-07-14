import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

/**
 * Generate an **un-finalised** crawl stub directory for the viewer's stub-mode
 * E2E suite.
 *
 * Mirrors `generate-fixture.mjs` (the finished-archive variant), but stops
 * before `archive.write()` / `archive.close()` — so what ends up on disk is
 * the same shape a user gets when they interrupt a crawl: a SQLite-bearing
 * tmpDir, no `.nitpicker` file, no zipped snapshots. The companion lock
 * directory is removed so the viewer treats the stub as offline (no PID
 * warning) and produces deterministic test output.
 */
const dirname = import.meta.dirname;
const STUB_NAME = 'e2e-stub';
const STUB_PARENT = path.resolve(dirname, '.fixture-stub-cwd');
const STUB_DIR = path.resolve(STUB_PARENT, `._nitpicker-${STUB_NAME}`);
const PAGE_COUNT = 5;

rmSync(STUB_PARENT, { recursive: true, force: true });
mkdirSync(STUB_PARENT, { recursive: true });

const archive = await Archive.create({
	filePath: path.resolve(STUB_PARENT, `${STUB_NAME}.nitpicker`),
	cwd: STUB_PARENT,
});

await archive.setConfig({
	baseUrl: 'https://example.com',
	name: STUB_NAME,
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
	userAgent: 'e2e-stub',
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
		html: `<html><head><title>Stub page ${i}</title></head><body><h1>Stub page ${i}</h1></body></html>`,
		meta: {
			lang: 'ja',
			title: `Stub page ${i}`,
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

// Cleanly release the writer's SQLite handle and the advisory lock
// WITHOUT zipping or removing the tmpDir — that's exactly what
// `releaseHandle()` is for. It also removes the `.lock` sibling so the
// viewer treats this fixture as an interrupted (not live) crawl. With
// the handle dropped, Node's event loop can drain and the script exits
// on its own; no `process.exit(0)` race against a late WAL writeback.
await archive.releaseHandle();

// eslint-disable-next-line no-console
console.log(`E2E stub fixture created: ${STUB_DIR}`);
