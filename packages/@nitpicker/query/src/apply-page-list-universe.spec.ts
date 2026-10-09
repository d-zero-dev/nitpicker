import type { PageData } from '@nitpicker/archive/utils/types/types';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyPageListUniverse } from './apply-page-list-universe.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_apply_page_list_universe__');

const META: PageData['meta'] = {
	lang: 'ja',
	title: 'T',
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
 * Builds a `PageData`, overridable per case.
 * @param url - The page URL.
 * @param overrides - Fields to override on the default crawl-target shape.
 * @returns The page data.
 */
function makePage(url: string, overrides: Partial<PageData> = {}): PageData {
	return {
		url: parseUrl(url)!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '<html></html>',
		meta: META,
		anchorList: [],
		imageList: [],
		isSkipped: false,
		...overrides,
	};
}

describe('applyPageListUniverse', () => {
	let archive: InstanceType<typeof Archive>;
	const ids = new Map<string, number>();

	/**
	 * Selects the URLs the helper admits, sorted.
	 * @param allowedInternalPageIds - The `fromList` allow-list, or none.
	 * @returns The admitted URLs.
	 */
	async function admittedUrls(
		allowedInternalPageIds?: ReadonlySet<number> | null,
	): Promise<string[]> {
		const rows = (await archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ur.url as url')
			.modify((qb) => applyPageListUniverse(qb, { alias: 'ci', allowedInternalPageIds }))
			.orderBy('ur.url')) as { url: string }[];
		return rows.map((r) => r.url);
	}

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'universe.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
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
			userAgent: 'test',
			ignoreRobots: false,
		});
		await archive.setPage(makePage('https://example.com/target'));
		await archive.setPage(
			makePage('https://example.com/incidental', { isTarget: false }),
		);
		await archive.setPage(makePage('https://example.com/dest'));
		await archive.setRedirect(
			makePage('https://example.com/moved', {
				redirectPaths: ['https://example.com/dest'],
				status: 301,
			}),
		);
		await archive.setPage(
			makePage('https://example.net/', { isExternal: true, isTarget: false }),
		);
		await archive.setSkippedPage('https://example.com/skipped', 'excluded');

		const rows = (await archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id', 'ur.url as url')) as { id: number; url: string }[];
		for (const row of rows) {
			ids.set(row.url, row.id);
		}
	});

	afterAll(async () => {
		await archive.releaseHandle();
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('admits scraped targets, external rows and redirect sources, but not incidental or skipped rows', async () => {
		expect(await admittedUrls()).toEqual([
			'https://example.com/dest',
			'https://example.com/moved',
			'https://example.com/target',
			'https://example.net',
		]);
	});

	it('restricts internal rows to the allow-list while never restricting external rows', async () => {
		const allowed = new Set([ids.get('https://example.com/target')!]);
		expect(await admittedUrls(allowed)).toEqual([
			'https://example.com/target',
			'https://example.net',
		]);
	});

	it('treats an empty allow-list as "no internal rows", not as "no restriction"', async () => {
		expect(await admittedUrls(new Set())).toEqual(['https://example.net']);
	});

	it('treats a null allow-list as no restriction', async () => {
		expect(await admittedUrls(null)).toEqual(await admittedUrls());
	});
});
