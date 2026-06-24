import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

const dirname = import.meta.dirname;
const FIXTURE_PATH = path.resolve(dirname, '.fixture.nitpicker');
const FIXTURE_CWD = path.resolve(dirname, '.fixture-tmp');
// Bumped from 50 → 120 so the default MPA `pageSize=100` paginates (Next
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
	version: '0.10.0',
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
				? Array.from({ length: PAGE_COUNT - 1 }, (_, j) => ({
						href: parseUrl(`https://example.com/page-${j + 1}`),
						isExternal: false,
						title: null,
						textContent: `Page ${j + 1}`,
					}))
				: i < PAGE_COUNT - 1
					? [
							{
								href: parseUrl(`https://example.com/page-${i + 1}`),
								isExternal: false,
								title: null,
								textContent: 'Next',
							},
						]
					: [],
		imageList: [],
		isSkipped: false,
	});
}

await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E fixture created: ${FIXTURE_PATH}`);
