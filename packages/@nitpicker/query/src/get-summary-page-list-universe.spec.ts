import type { PageData } from '@nitpicker/crawler';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSummary } from './get-summary.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const META: PageData['meta'] = {
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
 * Builds a `PageData` for a scraped HTML page, overridable per case.
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
		meta: { ...META, title: url },
		anchorList: [],
		imageList: [],
		isSkipped: false,
		...overrides,
	};
}

/**
 * Creates an archive with the shared base config.
 * @param dir - The working directory to create it in.
 * @param fileName - The `.nitpicker` file name.
 * @param config - Per-case config overrides.
 * @param config.fromList - Whether the archive was crawled from a URL list.
 * @param config.roots - The root URLs.
 * @returns The created archive.
 */
async function createArchive(
	dir: string,
	fileName: string,
	config: { fromList: boolean; roots: string[] },
): Promise<InstanceType<typeof Archive>> {
	mkdirSync(dir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(dir, fileName),
		cwd: dir,
	});
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.13.0',
		recursive: !config.fromList,
		interval: 0,
		image: false,
		fetchExternal: false,
		parallels: 1,
		excludes: [],
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
		retry: 3,
		disableQueries: false,
		userAgent: 'test',
		ignoreRobots: false,
		...config,
	});
	return archive;
}

/**
 * Looks up a `content_items.id` by URL.
 * @param archive - The archive to query.
 * @param url - The page URL.
 * @returns The content item id.
 */
async function idOf(archive: InstanceType<typeof Archive>, url: string): Promise<number> {
	const row = (await archive
		.getKnex()('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where('ur.url', url)
		.first('ci.id as id')) as { id: number };
	return row.id;
}

describe('getSummary: Page List row universe', () => {
	const dir = path.resolve(__dirname, '__test_fixtures_summary_universe__');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		archive = await createArchive(dir, 'universe.nitpicker', {
			fromList: false,
			roots: ['https://example.com'],
		});
		await archive.setPage(
			makePage('https://example.com/', { meta: { ...META, title: 'Home' } }),
		);
		await archive.setPage(
			makePage('https://example.com/dest', { meta: { ...META, title: 'Dest' } }),
		);
		// Fetched incidentally (not a crawl target) and not a redirect source:
		// the Page List never lists it, so Summary must not count it.
		await archive.setPage(
			makePage('https://example.com/incidental', { isTarget: false }),
		);
		await archive.setRedirect(
			makePage('https://example.com/moved', {
				redirectPaths: ['https://example.com/dest'],
				status: 301,
				contentType: null,
			}),
		);
		await archive.setPage(
			makePage('https://example.net/', { isExternal: true, isTarget: false }),
		);
	});

	afterAll(async () => {
		await archive.releaseHandle();
		rmSync(dir, { recursive: true, force: true });
	});

	it('counts crawl targets and redirect sources, but not incidentally fetched internal pages', async () => {
		const summary = await getSummary(archive);
		expect(summary).toMatchObject({
			totalPages: 4,
			internalPages: 3,
			externalPages: 1,
			internalContents: 3,
			externalContents: 1,
		});
	});

	it('shows the redirect source as a 3xx row in the status distribution', async () => {
		const summary = await getSummary(archive);
		expect(summary.statusDistribution).toEqual([
			{ status: 200, count: 3 },
			{ status: 301, count: 1 },
		]);
	});

	it('reads a redirect source as Content-Type unknown, like its Page List row', async () => {
		const summary = await getSummary(archive);
		expect(summary.contentTypeDistribution).toEqual([
			{ category: 'html', internal: 2, external: 1 },
			{ category: 'unknown', internal: 1, external: 0 },
		]);
	});

	it('keeps redirect sources out of the metadata fulfillment denominator', async () => {
		const summary = await getSummary(archive);
		// Denominator is "/" and "/dest" only; both have a title, none a description.
		expect(summary.metadataFulfillment).toEqual({
			title: 1,
			description: 0,
			keywords: 0,
			ogTitle: 0,
			ogDescription: 0,
			ogImage: 0,
		});
	});
});

describe('getSummary: fromList page scope', () => {
	const ROOTS = [
		'https://example.com/a',
		'https://example.com/redirect-root',
		'https://example.com/multi-hop-root',
	];

	/**
	 * Builds the shared fixture: in-list page, off-list scraped pages, an
	 * off-list failed page, redirecting roots, technologies and console logs
	 * on both an in-list and an off-list page.
	 * @param dir - The working directory.
	 * @param fromList - Whether to mark the archive as crawled from a list.
	 * @returns The populated archive.
	 */
	async function buildFixture(
		dir: string,
		fromList: boolean,
	): Promise<InstanceType<typeof Archive>> {
		const archive = await createArchive(dir, 'from-list.nitpicker', {
			fromList,
			roots: ROOTS,
		});
		await archive.setPage(makePage('https://example.com/a'));
		// Off-list, scraped in full anyway (the #369 shape).
		await archive.setPage(makePage('https://example.com/b'));
		// Off-list hard failure.
		await archive.setPage(
			makePage('https://example.com/broken', {
				status: -1,
				statusText: 'ERR_NAME_NOT_RESOLVED',
				contentType: null,
			}),
		);
		await archive.setPage(
			makePage('https://example.net/', { isExternal: true, isTarget: false }),
		);
		// A root that redirects to an off-list destination: the destination
		// is admitted although it was never itself on the list.
		await archive.setPage(makePage('https://example.com/off-list-destination'));
		await archive.setRedirect(
			makePage('https://example.com/redirect-root', {
				redirectPaths: ['https://example.com/off-list-destination'],
				status: 301,
				contentType: null,
			}),
		);
		// root -> hop1 -> final: hop1 is a redirect source that is not a root.
		await archive.setPage(makePage('https://example.com/final'));
		await archive.setRedirect(
			makePage('https://example.com/multi-hop-root', {
				redirectPaths: ['https://example.com/hop1', 'https://example.com/final'],
				status: 301,
				contentType: null,
			}),
		);

		await archive
			.getKnex()('page_technologies')
			.insert([
				{
					pageId: await idOf(archive, 'https://example.com/a'),
					technology: 'TechA',
					category: 'cms',
					version: null,
					confidence: 100,
					signalCount: 1,
				},
				{
					pageId: await idOf(archive, 'https://example.com/b'),
					technology: 'TechB',
					category: 'cms',
					version: null,
					confidence: 100,
					signalCount: 1,
				},
			]);
		await archive.setConsoleLogs(
			'https://example.com/a',
			[],
			[
				{
					pageUrl: 'https://example.com/a',
					type: 'error',
					text: 'e',
					args: [],
					ts: 1,
				},
			],
		);
		await archive.setConsoleLogs(
			'https://example.com/b',
			[],
			[
				{
					pageUrl: 'https://example.com/b',
					type: 'error',
					text: 'e',
					args: [],
					ts: 2,
				},
				{
					pageUrl: 'https://example.com/b',
					type: 'warn',
					text: 'w',
					args: [],
					ts: 3,
				},
			],
		);
		return archive;
	}

	describe('fromList archive', () => {
		const dir = path.resolve(__dirname, '__test_fixtures_summary_from_list__');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await buildFixture(dir, true);
		});

		afterAll(async () => {
			await archive.releaseHandle();
			rmSync(dir, { recursive: true, force: true });
		});

		it('counts only internal pages reachable from the roots, plus external pages', async () => {
			const summary = await getSummary(archive);
			// a, redirect-root, off-list-destination, multi-hop-root, final — not b, broken, hop1.
			expect(summary).toMatchObject({
				totalPages: 6,
				internalPages: 5,
				externalPages: 1,
				internalContents: 5,
				externalContents: 1,
			});
		});

		it('leaves off-list pages out of the status distribution, including the failed one', async () => {
			const summary = await getSummary(archive);
			expect(summary.statusDistribution).toEqual([
				{ status: 200, count: 4 },
				{ status: 301, count: 2 },
			]);
			expect(summary.networkOutageAffectedFailures).toBe(0);
		});

		it('counts technologies only for pages inside the scope', async () => {
			const summary = await getSummary(archive);
			expect(summary.technologyDistribution).toEqual([
				{ technology: 'TechA', pageCount: 1 },
			]);
		});

		it('counts console logs only for pages inside the scope', async () => {
			const summary = await getSummary(archive);
			expect(summary.consoleLogCounts).toEqual({ pageerror: 0, error: 1, warn: 0 });
		});

		it('still reports the unrestricted roots in the config echo', async () => {
			const summary = await getSummary(archive);
			expect(summary.roots).toEqual(ROOTS);
		});
	});

	describe('non-fromList archive with the same rows', () => {
		const dir = path.resolve(__dirname, '__test_fixtures_summary_not_from_list__');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await buildFixture(dir, false);
		});

		afterAll(async () => {
			await archive.releaseHandle();
			rmSync(dir, { recursive: true, force: true });
		});

		it('is not scoped to the roots', async () => {
			const summary = await getSummary(archive);
			// a, b, broken, redirect-root, off-list-destination, multi-hop-root, hop1, final.
			expect(summary).toMatchObject({
				totalPages: 9,
				internalPages: 8,
				externalPages: 1,
			});
			expect(summary.statusDistribution.map((s) => [s.status, s.count])).toEqual([
				[-1, 1],
				[200, 5],
				[301, 3],
			]);
			expect(summary.technologyDistribution).toEqual([
				{ technology: 'TechA', pageCount: 1 },
				{ technology: 'TechB', pageCount: 1 },
			]);
			expect(summary.consoleLogCounts).toEqual({ pageerror: 0, error: 2, warn: 1 });
		});
	});
});
