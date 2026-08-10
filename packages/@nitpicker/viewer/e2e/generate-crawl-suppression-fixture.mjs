import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';

const dirname = import.meta.dirname;
const FIXTURE_PATH = path.resolve(dirname, '.fixture-crawl-suppression.nitpicker');
const FIXTURE_CWD = path.resolve(dirname, '.fixture-crawl-suppression-tmp');

rmSync(FIXTURE_PATH, { force: true });
rmSync(FIXTURE_CWD, { recursive: true, force: true });
mkdirSync(FIXTURE_CWD, { recursive: true });

const archive = await Archive.create({ filePath: FIXTURE_PATH, cwd: FIXTURE_CWD });
await archive.setConfig({
	baseUrl: 'https://example.com',
	name: 'e2e-crawl-suppression-fixture',
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
 * Registers one internal, successfully-crawled page.
 * @param url - The page's absolute URL.
 */
async function crawlPage(url) {
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
		html: '<html><head><title>お知らせ</title></head><body>page body</body></html>',
		meta: { title: 'お知らせ' },
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
}

// Event A: finalized (rejected_count set), two pages already captured by the
// post-hoc marking backfill, and a sample_url that was itself crawled (so
// the view can link it to page detail).
await crawlPage('https://example.com/news/date/2020/');
await crawlPage('https://example.com/news/date/2021/');

const eventIdA = await archive.insertDedupeCapEvent({
	shapeKey: 'example.com/news/date/{n}/',
	sampleUrl: 'https://example.com/news/date/2020/',
	bodyHash: Buffer.from('trap-body-hash-a'),
	effectiveThreshold: 5,
	observedCount: 8,
	detectedAt: 1_700_000_000_000,
});
await archive.finalizeDedupeCapEvent(eventIdA, 42);

// Event B: never finalized (rejected_count stays NULL — simulates a crawl
// that was interrupted before crawlEnd), and a sample_url that was rejected
// rather than crawled (so the view must render it as plain text, not a
// link, and "0 pages captured" with no view-pages link).
await archive.insertDedupeCapEvent({
	shapeKey: 'example.com/search/?page={v}',
	sampleUrl: 'https://example.com/search/?page=999',
	bodyHash: null,
	effectiveThreshold: 5,
	observedCount: 5,
	detectedAt: 1_700_000_500_000,
});

const knex = archive.getKnex();
// A plain `.join().update()` chain silently drops the JOIN when compiled
// for SQLite (knex has no UPDATE...JOIN support for this dialect); a
// `whereIn` subquery avoids the join entirely.
await knex('content_items')
	.whereIn(
		'url_id',
		knex('url_refs')
			.select('id')
			.whereIn('url', [
				'https://example.com/news/date/2020/',
				'https://example.com/news/date/2021/',
			]),
	)
	.update({ dedupe_cap_event_id: eventIdA });

await buildViewerReadModel(archive);
await archive.write();
await archive.close();
// eslint-disable-next-line no-console
console.log(`E2E crawl-suppression fixture created: ${FIXTURE_PATH}`);
