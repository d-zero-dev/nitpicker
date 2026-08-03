import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager, buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
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

/**
 * Builds a fixture archive with 5 internal HTML pages (`a`..`e`) and returns
 * an in-process Hono app wired to it via the same read-only-open path the
 * real viewer uses (`ArchiveManager.open` against the archive's own tmpDir —
 * `Archive.create`'s tmpDir is a valid stub-mode source, so this opens
 * read-only without ever writing a `.nitpicker` tar).
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_pages` read model
 *   before opening read-only (exercises the fast path) or leave it unbuilt
 *   (exercises the live fallback path).
 * @param responseHeadersByLetter - Optional per-page response headers,
 *   keyed by the page's letter suffix. Defaults to no headers on every page.
 * @returns The app, archive, and manager — callers must close both in
 *   `afterAll`.
 */
async function buildFixture(
	workingDir: string,
	withReadModel: boolean,
	responseHeadersByLetter: Record<string, Record<string, string>> = {},
) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);
	for (const letter of ['a', 'b', 'c', 'd', 'e']) {
		await archive.setPage({
			url: parseUrl(`https://example.com/${letter}`)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: responseHeadersByLetter[letter] ?? {},
			html: '<html></html>',
			meta: { ...META, title: letter.toUpperCase() },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	if (withReadModel) {
		await buildViewerReadModel(archive);
	}

	const manager = new ArchiveManager();
	const { archiveId, mode } = await manager.open(archive.tmpDir);
	const app = createApp({
		context: {
			manager,
			archiveId,
			filePath: archive.tmpDir,
			mode,
			crawlerLockHolder: null,
		},
		publicDir: '/tmp/no-such-dir-register-pages-route-spec',
	});
	return { app, archive, manager };
}

/**
 * Builds a fixture archive with pages under `/blog/2024/`, its subdirectory
 * `/blog/2024/sub/`, and the literal-prefix sibling `/blog2/` — enough
 * structure to exercise the `directory` filter's whole-subtree match and its
 * sibling-prefix exclusion. The read model is always built (this fixture
 * only exercises the fast path).
 * @param workingDir - Unique scratch directory for this fixture.
 * @returns The app, archive, and manager — callers must close both in
 *   `afterAll`.
 */
async function buildDirectoryFixture(workingDir: string) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);
	for (const pagePath of [
		'/blog/2024/post-a',
		'/blog/2024/sub/post-b',
		'/blog2/post-c',
	]) {
		await archive.setPage({
			url: parseUrl(`https://example.com${pagePath}`)!,
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
		});
	}
	await buildViewerReadModel(archive);

	const manager = new ArchiveManager();
	const { archiveId, mode } = await manager.open(archive.tmpDir);
	const app = createApp({
		context: {
			manager,
			archiveId,
			filePath: archive.tmpDir,
			mode,
			crawlerLockHolder: null,
		},
		publicDir: '/tmp/no-such-dir-register-pages-route-spec',
	});
	return { app, archive, manager };
}

/**
 * Drives `/api/pages?limit=...` to exhaustion via `nextCursor` alone (the
 * same continuation contract `usePagesInfinite` relies on), collecting every
 * page's URLs in request order.
 * @param app - The in-process Hono app.
 * @param query - The base query string (without `limit`/`cursor`), e.g. `''`
 *   or `'&urlPattern=%25example.com%25'`.
 * @param limit - The page size.
 * @param maxPages - Safety cap so a broken "never terminates" regression
 *   fails the test instead of hanging.
 * @returns The concatenated URLs across every page, in order.
 */
async function paginateAllViaNextCursor(
	app: ReturnType<typeof createApp>,
	query: string,
	limit: number,
	maxPages = 10,
): Promise<string[]> {
	const urls: string[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < maxPages; page++) {
		const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
		const res = await app.request(`/api/pages?limit=${limit}${cursorParam}${query}`);
		const body = (await res.json()) as {
			items: { url: string }[];
			nextCursor: string | null;
		};
		urls.push(...body.items.map((i) => i.url));
		if (!body.nextCursor) {
			return urls;
		}
		cursor = body.nextCursor;
	}
	throw new Error(`paginateAllViaNextCursor: did not terminate within ${maxPages} pages`);
}

describe('registerPagesRoute (integration)', () => {
	describe('fast path (viewer_pages read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_fast__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('paginates to completion via nextCursor with no duplicates or gaps', async () => {
			const urls = await paginateAllViaNextCursor(fixture.app, '', 2);
			expect(urls).toEqual([
				'https://example.com/a',
				'https://example.com/b',
				'https://example.com/c',
				'https://example.com/d',
				'https://example.com/e',
			]);
		});

		it('OR-filters across a repeated status query param', async () => {
			const res = await fixture.app.request('/api/pages?status=200&status=404');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(5);
		});
	});

	describe('fast path — contentTypeCategory drops an invalid value from a repeated query param', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_content_type_category__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
			// `buildFixture`'s 5 pages are all 'text/html' → category
			// 'html'. Add one 'application/pdf' page (category 'pdf') so a
			// `contentTypeCategory=html` filter has a non-matching row to
			// exclude — otherwise every fixture page being 'html' would
			// make "the filter matched everything" indistinguishable from
			// "no filter was applied at all".
			await fixture.archive.setPage({
				url: parseUrl('https://example.com/doc.pdf')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'application/pdf',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			await buildViewerReadModel(fixture.archive);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('keeps the valid html value and ignores the bogus one, excluding the pdf page', async () => {
			const res = await fixture.app.request(
				'/api/pages?contentTypeCategory=bogus&contentTypeCategory=html',
			);
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(5);
			expect(body.items.map((i) => i.url)).not.toContain('https://example.com/doc.pdf');
		});
	});

	describe('live fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_live_no_read_model__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, false);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('still paginates to completion via nextCursor using the offset-based pseudo-cursor (regression: without it, pagination sticks at page 1)', async () => {
			const urls = await paginateAllViaNextCursor(fixture.app, '', 2);
			expect(urls).toEqual([
				'https://example.com/a',
				'https://example.com/b',
				'https://example.com/c',
				'https://example.com/d',
				'https://example.com/e',
			]);
		});

		it('narrows a multi-value contentTypeCategory to its first element (live path has no OR equivalent)', async () => {
			// Every fixture page is 'text/html' → category 'html'. Putting
			// the non-matching 'other' category first proves the live
			// path uses only that first element rather than OR-ing across
			// the whole array — if it did, the 'html' value later in the
			// array would still make every page match.
			const res = await fixture.app.request(
				'/api/pages?contentTypeCategory=other&contentTypeCategory=html',
			);
			const body = (await res.json()) as { items: unknown[]; total: number };
			expect(body.total).toBe(0);
		});
	});

	describe('live fallback path (urlPattern forces the live path even though a read model exists)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_live_urlpattern__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('still paginates to completion via nextCursor (regression: without the pseudo-cursor, pagination sticks at page 1)', async () => {
			const urls = await paginateAllViaNextCursor(
				fixture.app,
				`&urlPattern=${encodeURIComponent('%example.com%')}`,
				2,
			);
			expect(urls).toEqual([
				'https://example.com/a',
				'https://example.com/b',
				'https://example.com/c',
				'https://example.com/d',
				'https://example.com/e',
			]);
		});
	});

	describe('header-presence filter (hasCSP) forces live path even though a read model exists', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_header_filter__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true, {
				a: { 'content-security-policy': "default-src 'self'" },
			});
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns only the page with the CSP header, not the whole unfiltered set', async () => {
			const res = await fixture.app.request('/api/pages?hasCSP=true');
			const body = (await res.json()) as { items: { url: string }[] };
			expect(body.items.map((i) => i.url)).toEqual(['https://example.com/a']);
		});
	});

	describe('fast path (viewer_pages read model built, no header filter)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_header_display__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true, {
				a: { 'content-security-policy': "default-src 'self'" },
			});
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('reports hasCSP correctly per page instead of always false (regression: a fast-path join that drops header columns reports all-false)', async () => {
			const res = await fixture.app.request('/api/pages');
			const body = (await res.json()) as { items: { url: string; hasCSP: boolean }[] };
			const byUrl = new Map(body.items.map((i) => [i.url, i.hasCSP]));
			expect(byUrl.get('https://example.com/a')).toBe(true);
			expect(byUrl.get('https://example.com/b')).toBe(false);
		});
	});

	describe('templateKey filter stays on the fast path (page_id-PK join to page_templates, no live fallback)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_template_key_filter__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
			await fixture.archive.replacePageTemplates(
				new Map([
					['https://example.com/a', 'template-a'],
					['https://example.com/b', 'template-a'],
					['https://example.com/c', 'template-c'],
				]),
				new Map(),
			);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns only pages with the matching templateKey, not the whole unfiltered set', async () => {
			const res = await fixture.app.request('/api/pages?templateKey=template-a');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.items.map((i) => i.url)).toEqual([
				'https://example.com/a',
				'https://example.com/b',
			]);
			expect(body.total).toBe(2);
		});

		it('mints an opaque base64url keyset cursor, not the live plain-decimal offset cursor (regression: forcing live would change the cursor format)', async () => {
			const res = await fixture.app.request('/api/pages?templateKey=template-a&limit=1');
			const body = (await res.json()) as { nextCursor: string | null };
			expect(body.nextCursor).not.toBeNull();
			expect(body.nextCursor).not.toMatch(/^\d+$/);
		});

		it('paginates to completion via nextCursor', async () => {
			const urls = await paginateAllViaNextCursor(
				fixture.app,
				'&templateKey=template-a',
				1,
			);
			expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);
		});

		it('OR-filters across a repeated templateKey query param', async () => {
			const res = await fixture.app.request(
				'/api/pages?templateKey=template-a&templateKey=template-c',
			);
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.items.map((i) => i.url).toSorted()).toEqual([
				'https://example.com/a',
				'https://example.com/b',
				'https://example.com/c',
			]);
			expect(body.total).toBe(3);
		});
	});

	describe('fast path (viewer_pages read model built, no templateKey filter)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_template_key_display__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
			await fixture.archive.replacePageTemplates(
				new Map([['https://example.com/a', 'template-a']]),
				new Map(),
			);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('reports templateKey correctly per page via the fast-path post-hoc join (viewer_pages itself has no such column)', async () => {
			const res = await fixture.app.request('/api/pages');
			const body = (await res.json()) as {
				items: { url: string; templateKey: string | null }[];
			};
			const byUrl = new Map(body.items.map((i) => [i.url, i.templateKey]));
			expect(byUrl.get('https://example.com/a')).toBe('template-a');
			expect(byUrl.get('https://example.com/b')).toBeNull();
		});
	});

	describe('directory filter takes the fast path and matches the whole subtree', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_pages_route_directory__',
		);
		let fixture: Awaited<ReturnType<typeof buildDirectoryFixture>>;

		beforeAll(async () => {
			fixture = await buildDirectoryFixture(workingDir);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('matches the directory and its descendants, not a literal-prefix sibling', async () => {
			const res = await fixture.app.request(
				`/api/pages?directory=${encodeURIComponent('/blog/2024/')}`,
			);
			const body = (await res.json()) as { items: { url: string }[] };
			expect(body.items.map((i) => i.url).toSorted()).toEqual([
				'https://example.com/blog/2024/post-a',
				'https://example.com/blog/2024/sub/post-b',
			]);
		});
	});
});
