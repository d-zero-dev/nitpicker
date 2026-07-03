import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeExternalLinkRows } from './compute-external-link-rows.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
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
	userAgent: 'test',
	ignoreRobots: false,
};

const META = {
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
};

describe('computeExternalLinkRows', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_external_link_rows__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-external-link-rows-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// Page A: two anchors to ads.example.com (same page, must count as one
		// referrer, not two), plus one to tracking.
		await archive.setPage({
			url: parseUrl('https://example.com/page-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Page A' },
			anchorList: [
				{
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad banner',
				},
				{
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad footer',
				},
				{
					href: parseUrl('https://tracking.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Tracking',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// Page B: a second, distinct referrer to ads.example.com.
		await archive.setPage({
			url: parseUrl('https://example.com/page-b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Page B' },
			anchorList: [
				{
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad sidebar',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://ads.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://tracking.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('groups anchors by canonical destination, one row per unique destination', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeExternalLinkRows(trx));
		expect(rows).toHaveLength(2);
	});

	it('counts referrers by distinct page id, not anchor count', async () => {
		// Page A has two <a> tags to ads.example.com; combined with page B
		// that's 2 distinct referring pages, not 3 anchors.
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeExternalLinkRows(trx));
		const ads = rows.find((row) => row.dest_url === 'https://ads.example.com');
		expect(ads).toMatchObject({ status: 200, referrer_count: 2 });
	});

	it('carries the canonical destination status through', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeExternalLinkRows(trx));
		const tracking = rows.find((row) => row.dest_url === 'https://tracking.example.com');
		expect(tracking).toMatchObject({ status: 404, referrer_count: 1 });
	});
});

/**
 * Mirrors `list-external-links.spec.ts`'s redirect-resolution describe
 * block: an anchor to an internal redirect-source page and an anchor
 * directly to the same external canonical destination must collapse into a
 * single `viewer_external_links` row, not two.
 */
describe('computeExternalLinkRows — redirect resolution', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_external_link_rows_redirect__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-external-link-rows-redirect-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/direct')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Direct' },
			anchorList: [
				{
					href: parseUrl('https://redirect-target.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Direct link',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/via-redirect')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Via redirect' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old')!,
					isExternal: false,
					title: null,
					textContent: 'Old link',
					hash: null,
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://redirect-target.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setRedirect({
			url: parseUrl('https://example.com/old')!,
			redirectPaths: ['https://redirect-target.example.com/'],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('collapses a redirect-source anchor and a direct anchor onto the same canonical destination row', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeExternalLinkRows(trx));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			dest_url: 'https://redirect-target.example.com',
			referrer_count: 2,
		});
	});
});
