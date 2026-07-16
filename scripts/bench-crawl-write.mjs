#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Benchmarks `Archive.setPage()` write throughput for N synthetic pages.
 *
 * Measures ONLY this checkout's write path — it has no "old" writer to
 * compare against in-process, since the legacy flat-table writer (issue
 * #196) was removed from this branch. To validate the acceptance
 * criterion (write overhead <= 20% vs the pre-#196 writer), run this same
 * script unmodified against two checkouts (e.g. via `git worktree add` at
 * the pre-#196 commit and at the current HEAD) and compare the reported
 * total time — `Archive.setPage()`'s public signature is unchanged across
 * both, so the script needs no edits between runs.
 * @example
 * node scripts/bench-crawl-write.mjs 10000
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// eslint-disable-next-line import-x/no-extraneous-dependencies -- workspace dep, same import other scripts/*.mjs already use
import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import Archive from '../packages/@nitpicker/crawler/lib/archive/archive.js';

const PAGE_COUNT = Number(process.argv[2]) || 10_000;
const ANCHOR_FANOUT = 5;
const IMAGE_COUNT = 2;
const PROGRESS_INTERVAL = 1000;

// A real site's header/footer nav repeats the same anchor text and a
// handful of hub destinations (home/about/contact/...) on every page —
// only in-content links and the page's own title are genuinely unique
// per page. A dataset where every string is unique (title, anchor text,
// image alt, dom path) is a pessimistic worst case that does not reflect
// a real crawl, and makes the ref-table dictionary upserts (text_refs /
// url_refs) look artificially expensive since nothing is ever a cache
// hit. `NAV_LABELS` / `NAV_TARGETS` model that realistic repetition.
const NAV_LABELS = ['Home', 'About', 'Products', 'Contact', 'Blog', 'Support'];
const NAV_TARGET_COUNT = 8;
const ICON_ALT_POOL = ['site logo', 'menu icon', 'search icon'];

const NOOP_META = {
	lang: 'en',
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
 * Builds one synthetic page's write payload. `ANCHOR_FANOUT - 1` anchors
 * reuse the fixed nav label/destination pool (as a real header/footer
 * would); the last anchor is a unique in-content link to another
 * synthetic page, so `anchor_edges` sees both cache-hit and cache-miss
 * upserts. Images likewise mix a shared "site icon" (pooled alt/dom path)
 * with one page-unique content image.
 * @param i - Zero-based page index.
 * @returns A `PageData`-shaped object accepted by `Archive.setPage()`.
 */
function buildPageData(i) {
	const anchorList = [];
	for (let a = 0; a < ANCHOR_FANOUT - 1; a++) {
		const target = a % NAV_TARGET_COUNT;
		anchorList.push({
			href: parseUrl(`https://bench.example/page-${target}`),
			textContent: NAV_LABELS[a % NAV_LABELS.length],
			isExternal: false,
		});
	}
	const contentTarget = (i + 1) % PAGE_COUNT;
	anchorList.push({
		href: parseUrl(`https://bench.example/page-${contentTarget}`),
		textContent: `Read more: page ${contentTarget}`,
		isExternal: false,
	});

	const imageList = [];
	for (let n = 0; n < IMAGE_COUNT - 1; n++) {
		imageList.push({
			src: `https://bench.example/img/icon-${n}.png`,
			currentSrc: `https://bench.example/img/icon-${n}.png`,
			alt: ICON_ALT_POOL[n % ICON_ALT_POOL.length],
			width: 24,
			height: 24,
			naturalWidth: 24,
			naturalHeight: 24,
			isLazy: false,
			viewportWidth: 1280,
			sourceCode: `<img src="img/icon-${n}.png" alt="${ICON_ALT_POOL[n % ICON_ALT_POOL.length]}">`,
		});
	}
	imageList.push({
		src: `https://bench.example/img/page-${i}-content.png`,
		currentSrc: `https://bench.example/img/page-${i}-content.png`,
		alt: `content photo for page ${i}`,
		width: 800,
		height: 600,
		naturalWidth: 800,
		naturalHeight: 600,
		isLazy: true,
		viewportWidth: 1280,
		sourceCode: `<img src="img/page-${i}-content.png" alt="content photo for page ${i}">`,
	});
	return {
		url: parseUrl(`https://bench.example/page-${i}`),
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 1024,
		responseHeaders: { 'content-type': 'text/html; charset=utf-8' },
		html: `<html><body><h1>Page ${i}</h1></body></html>`,
		meta: { ...NOOP_META, title: `Page ${i}` },
		anchorList,
		imageList,
		isSkipped: false,
	};
}

/**
 * Writes `PAGE_COUNT` synthetic pages to a fresh archive and prints the
 * total elapsed time.
 */
async function main() {
	const cwd = mkdtempSync(path.join(os.tmpdir(), 'nitpicker-bench-write-'));
	try {
		const filePath = path.join(cwd, 'bench.nitpicker');
		console.log(`Writing ${PAGE_COUNT} synthetic pages to ${filePath}`);

		const archive = await Archive.create({ filePath, cwd });
		try {
			await archive.setConfig({
				baseUrl: 'https://bench.example',
				name: 'bench',
				version: '0.13.0',
				recursive: true,
				interval: 0,
				image: true,
				fetchExternal: false,
				parallels: 1,
				roots: ['https://bench.example/'],
				excludes: [],
				excludeKeywords: [],
				excludeUrls: [],
				maxExcludedDepth: 0,
				retry: 3,
				fromList: false,
				disableQueries: false,
				userAgent: 'bench',
				ignoreRobots: false,
			});

			const start = process.hrtime.bigint();
			for (let i = 0; i < PAGE_COUNT; i++) {
				await archive.setPage(buildPageData(i));
				if ((i + 1) % PROGRESS_INTERVAL === 0) {
					const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
					console.log(
						`  ${i + 1}/${PAGE_COUNT} pages (${elapsedMs.toFixed(0)}ms elapsed, ${(elapsedMs / (i + 1)).toFixed(2)}ms/page)`,
					);
				}
			}
			const totalMs = Number(process.hrtime.bigint() - start) / 1e6;

			console.log('\n========== RESULT ==========');
			console.log(`  pageCount:    ${PAGE_COUNT}`);
			console.log(`  totalMs:      ${totalMs.toFixed(0)}`);
			console.log(`  msPerPage:    ${(totalMs / PAGE_COUNT).toFixed(3)}`);
			console.log(`  pagesPerSec:  ${(PAGE_COUNT / (totalMs / 1000)).toFixed(1)}`);
		} finally {
			await archive.releaseHandle();
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

await main();
