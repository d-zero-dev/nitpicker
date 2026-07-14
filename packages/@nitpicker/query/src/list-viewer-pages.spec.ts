import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listViewerPages } from './list-viewer-pages.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

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

/** Minimal page-fixture shape accepted by {@link addPage}. */
interface PageFixture {
	url: string;
	isExternal?: boolean;
	status?: number | null;
	contentType?: string | null;
	title?: string | null;
	description?: string | null;
	noindex?: boolean;
	source?: 'crawled' | 'inventory-seed' | 'inventory-discovered';
	lang?: string | null;
}

describe('listViewerPages', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_list_viewer_pages__');
	const archiveFilePath = path.resolve(workingDir, 'list-viewer-pages-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	/**
	 * Writes one fixture page via `archive.setPage`.
	 * @param fixture - The page fixture to write.
	 */
	async function addPage(fixture: PageFixture): Promise<void> {
		await archive.setPage(
			{
				url: parseUrl(fixture.url)!,
				redirectPaths: [],
				isExternal: fixture.isExternal ?? false,
				isTarget: true,
				status: fixture.status === undefined ? 200 : fixture.status,
				statusText: 'OK',
				contentType:
					fixture.contentType === undefined ? 'text/html' : fixture.contentType,
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: {
					...META,
					title: fixture.title ?? null,
					description: fixture.description ?? null,
					robots: { noindex: fixture.noindex ?? false },
					lang: fixture.lang ?? null,
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			fixture.source,
		);
	}

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// 5 internal HTML pages, url-ascending: a, b, c, d, e.
		await addPage({ url: 'https://example.com/a', title: 'A', status: 200, lang: 'ja' });
		await addPage({ url: 'https://example.com/b', title: 'B', status: 404, lang: 'en' });
		await addPage({
			url: 'https://example.com/c',
			title: null,
			description: null,
			status: 200,
			noindex: true,
		});
		await addPage({ url: 'https://example.com/d', title: 'D', status: 500 });
		await addPage({
			url: 'https://example.com/e',
			title: 'E',
			status: null,
			contentType: null,
		});

		// External page — excluded from the default isExternal=false-equivalent
		// view only when the caller actually filters on it (default view has no
		// isExternal filter at all, matching listPages' behavior).
		await addPage({ url: 'https://example.net/f', title: 'F', isExternal: true });

		// PDF — excluded from the default content_category view (html/unknown).
		await addPage({
			url: 'https://example.com/g.pdf',
			title: 'G',
			contentType: 'application/pdf',
			lang: 'fr',
		});

		// inventory-seed provenance, for the `source` filter.
		await addPage({ url: 'https://example.com/h', title: 'H', source: 'inventory-seed' });

		await populateMigrationTables(archive);
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns the default view (html + unknown content_category) in url-ascending order', async () => {
		const result = await listViewerPages(archive, { limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual([
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/c',
			'https://example.com/d',
			'https://example.com/e',
			'https://example.com/h',
			'https://example.net/f',
		]);
		// g.pdf is excluded from the default content_category view.
		expect(result.items.some((i) => i.url.endsWith('.pdf'))).toBe(false);
		expect(result.total).toBe(7);
		expect(result.nextCursor).toBeNull();
		expect(result.prevCursor).toBeNull();
	});

	it('joins back to the full pages row for display fields not stored in viewer_pages', async () => {
		const result = await listViewerPages(archive, { limit: 100 });
		const a = result.items.find((i) => i.url === 'https://example.com/a');
		expect(a).toMatchObject({ title: 'A', status: 200, isExternal: false });
	});

	it('filters by isExternal', async () => {
		const result = await listViewerPages(archive, { isExternal: true, limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual(['https://example.net/f']);
		expect(result.total).toBe(1);
	});

	it('filters by contentTypeCategory, relaxing the default html/unknown restriction', async () => {
		const result = await listViewerPages(archive, {
			contentTypeCategory: 'pdf',
			limit: 100,
		});
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/g.pdf']);
	});

	it('filters by exact status', async () => {
		const result = await listViewerPages(archive, { status: 404, limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/b']);
	});

	it('filters by statusMin/statusMax range', async () => {
		const result = await listViewerPages(archive, {
			statusMin: 400,
			statusMax: 499,
			limit: 100,
		});
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/b']);
	});

	it('filters by missingTitle', async () => {
		const result = await listViewerPages(archive, { missingTitle: true, limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/c']);
	});

	it('filters by missingDescription', async () => {
		const result = await listViewerPages(archive, {
			missingDescription: true,
			limit: 100,
		});
		expect(result.items.map((i) => i.url)).toContain('https://example.com/c');
	});

	it('filters by noindex', async () => {
		const result = await listViewerPages(archive, { noindex: true, limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/c']);
	});

	it('filters by source', async () => {
		const result = await listViewerPages(archive, {
			source: 'inventory-seed',
			limit: 100,
		});
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/h']);
	});

	it('sorts by title ascending, with url as the tie-breaker for the missing (empty sort key) title', async () => {
		const result = await listViewerPages(archive, {
			sortBy: 'title',
			sortOrder: 'asc',
			limit: 100,
		});
		// '' (missing title, page /c) sorts before any non-empty title.
		expect(result.items[0]?.url).toBe('https://example.com/c');
		expect(result.items.at(-1)?.title).toBe('H');
	});

	it('sorts by status descending, with ties (page /e, null status) breaking on url ascending', async () => {
		const result = await listViewerPages(archive, {
			sortBy: 'status',
			sortOrder: 'desc',
			limit: 100,
		});
		const statuses = result.items.map((i) => i.status);
		// 500, 404, 200, 200, 200, 200, null — descending, nulls last.
		expect(statuses[0]).toBe(500);
		expect(statuses.at(-1)).toBeNull();
		expect(statuses.indexOf(500)).toBeLessThan(statuses.indexOf(404));
	});

	describe('forward cursor pagination', () => {
		it('paginates through the default view with no gaps/overlaps and a null nextCursor on the last page', async () => {
			const page1 = await listViewerPages(archive, { limit: 3 });
			expect(page1.items.map((i) => i.url)).toEqual([
				'https://example.com/a',
				'https://example.com/b',
				'https://example.com/c',
			]);
			expect(page1.nextCursor).not.toBeNull();
			expect(page1.prevCursor).toBeNull();

			const page2 = await listViewerPages(archive, {
				limit: 3,
				cursor: page1.nextCursor!,
			});
			expect(page2.items.map((i) => i.url)).toEqual([
				'https://example.com/d',
				'https://example.com/e',
				'https://example.com/h',
			]);
			expect(page2.nextCursor).not.toBeNull();
			expect(page2.prevCursor).not.toBeNull();

			const page3 = await listViewerPages(archive, {
				limit: 3,
				cursor: page2.nextCursor!,
			});
			expect(page3.items.map((i) => i.url)).toEqual(['https://example.net/f']);
			expect(page3.nextCursor).toBeNull();
		});
	});

	describe('backward cursor pagination', () => {
		it("prevCursor navigates back to the exact previous page's items", async () => {
			const page1 = await listViewerPages(archive, { limit: 3 });
			const page2 = await listViewerPages(archive, {
				limit: 3,
				cursor: page1.nextCursor!,
			});

			const backToPage1 = await listViewerPages(archive, {
				limit: 3,
				cursor: page2.prevCursor!,
				direction: 'prev',
			});
			expect(backToPage1.items.map((i) => i.url)).toEqual(page1.items.map((i) => i.url));
			expect(backToPage1.prevCursor).toBeNull();
		});
	});

	describe('cursor validation', () => {
		it('rejects a malformed cursor', async () => {
			await expect(
				listViewerPages(archive, { cursor: 'not-a-cursor' }),
			).rejects.toThrow();
		});

		it('rejects a cursor replayed under a different filter', async () => {
			const page1 = await listViewerPages(archive, { limit: 3 });
			await expect(
				listViewerPages(archive, {
					limit: 3,
					isExternal: true,
					cursor: page1.nextCursor!,
				}),
			).rejects.toThrow(/does not match/);
		});

		it('rejects a cursor replayed under a different sort', async () => {
			const page1 = await listViewerPages(archive, { limit: 3 });
			await expect(
				listViewerPages(archive, {
					limit: 3,
					sortBy: 'title',
					cursor: page1.nextCursor!,
				}),
			).rejects.toThrow(/does not match/);
		});
	});

	describe('offset (page-number jump) pagination', () => {
		it('reads the correct window directly via OFFSET, matching cursor-based paging', async () => {
			const viaOffset = await listViewerPages(archive, { limit: 3, offset: 3 });
			expect(viaOffset.items.map((i) => i.url)).toEqual([
				'https://example.com/d',
				'https://example.com/e',
				'https://example.com/h',
			]);
			expect(viaOffset.offset).toBe(3);
			// offset > 0 always implies a previous page exists.
			expect(viaOffset.prevCursor).not.toBeNull();
		});

		it('offset=0 behaves identically to omitting offset', async () => {
			const withZero = await listViewerPages(archive, { limit: 3, offset: 0 });
			const omitted = await listViewerPages(archive, { limit: 3 });
			expect(withZero.items.map((i) => i.url)).toEqual(omitted.items.map((i) => i.url));
			expect(withZero.prevCursor).toBeNull();
		});
	});

	describe('facets', () => {
		it('returns precomputed status/lang/isExternal enum candidates for the default view', async () => {
			const result = await listViewerPages(archive, { limit: 100 });
			// Default view = html/unknown content_category (excludes g.pdf, whose
			// 'fr' lang and 'application/pdf' page must not leak into this scope).
			expect(result.facets).toEqual({
				statuses: [200, 404, 500],
				langs: ['en', 'ja'],
				types: [false, true],
			});
		});

		it('scopes facets to an explicit contentTypeCategory filter', async () => {
			const result = await listViewerPages(archive, {
				contentTypeCategory: 'pdf',
				limit: 100,
			});
			expect(result.facets).toEqual({
				statuses: [200],
				langs: ['fr'],
				types: [false],
			});
		});
	});

	describe('total does not reuse the seeded default profile total', () => {
		it("computes a live count that differs from viewer_query_profiles' unconditional 'default' total once non-HTML pages exist", async () => {
			// The seeded 'default' profile counts every viewer_pages row
			// unconditionally (8, including g.pdf) — a different quantity than
			// listViewerPages' own "no explicit filter" view, which still
			// applies the implicit html/unknown base restriction (7). Reusing
			// the seeded total for the latter would silently overcount.
			const knex = archive.getKnex();
			const profile = await knex('viewer_query_profiles')
				.where({ scope: 'pages', profile_key: 'default' })
				.first('total');
			expect(Number(profile.total)).toBe(8);

			const result = await listViewerPages(archive, { limit: 1 });
			expect(result.total).toBe(7);
		});
	});

	describe('EXPLAIN QUERY PLAN', () => {
		// A dedicated, larger (500-row) synthetic fixture: an 8-row archive is
		// too small for SQLite's planner (running without ANALYZE, per this
		// repo's standing "never ANALYZE a .nitpicker archive" rule) to
		// reliably prefer an index seek over a bare table scan. Rows are
		// inserted directly into `viewer_pages`, bypassing
		// `buildViewerReadModel`, purely to get realistic cardinality for the
		// planner to reason about.
		const explainWorkingDir = path.resolve(
			__dirname,
			'__test_fixtures_list_viewer_pages_explain__',
		);
		const explainArchiveFilePath = path.resolve(
			explainWorkingDir,
			'explain-test.nitpicker',
		);
		let explainArchive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(explainWorkingDir, { recursive: true });
			explainArchive = await Archive.create({
				filePath: explainArchiveFilePath,
				cwd: explainWorkingDir,
			});
			await explainArchive.setConfig(BASE_CONFIG);

			const { buildViewerReadModel: build } =
				await import('./viewer-read-model/build-viewer-read-model.js');
			// Seed one page so buildViewerReadModel creates the tables/indexes,
			// then bulk-insert the rest directly for speed.
			await explainArchive.setPage({
				url: parseUrl('https://example.com/seed')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...META, title: 'Seed' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			await build(explainArchive);

			const knex = explainArchive.getKnex();
			const statuses = [200, 301, 404, 500];
			const categories = ['html', 'unknown', 'pdf', 'image'];
			const rows = Array.from({ length: 500 }, (_, i) => {
				const status = statuses[i % statuses.length]!;
				return {
					page_id: i + 1000,
					url: `https://example.com/page-${i}`,
					title: `Page ${i}`,
					status,
					status_sort_key: status,
					status_desc_key: -status,
					content_category: categories[i % categories.length]!,
					is_external: i % 5 === 0 ? 1 : 0,
					has_title: 1,
					has_description: i % 3 === 0 ? 0 : 1,
					has_og_title: 1,
					robots_noindex: i % 7 === 0 ? 1 : 0,
					source: 'crawled',
					tag_count: 0,
					jsonld_count: 0,
					url_sort_key: `https://example.com/page-${i}`,
					title_sort_key: `Page ${i}`,
					path_sort_key: `/page-${i}`,
				};
			});
			await knex('viewer_pages').insert(rows);
		});

		afterAll(async () => {
			if (explainArchive) {
				await explainArchive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(explainWorkingDir, { recursive: true, force: true });
		});

		it('uses a named viewer_pages index (not a bare table scan) for the default-view id-resolution query', async () => {
			const knex = explainArchive.getKnex();
			const plan: { detail: string }[] = await knex.raw(
				'EXPLAIN QUERY PLAN ' +
					'SELECT page_id, url_sort_key FROM viewer_pages ' +
					"WHERE is_external = 0 AND content_category IN ('html', 'unknown') " +
					'ORDER BY url_sort_key, page_id LIMIT 100',
			);
			const details = plan.map((row) => row.detail).join(' | ');
			expect(details).toMatch(/USING (COVERING )?INDEX vp_\w+/);
			expect(details).not.toMatch(/SCAN viewer_pages\b/);
		});

		it('uses a named viewer_pages index (not a bare table scan) for a status-descending id-resolution query', async () => {
			const knex = explainArchive.getKnex();
			const plan: { detail: string }[] = await knex.raw(
				'EXPLAIN QUERY PLAN ' +
					'SELECT page_id, status_desc_key FROM viewer_pages ' +
					"WHERE is_external = 0 AND content_category IN ('html', 'unknown') " +
					'ORDER BY status_desc_key, url_sort_key, page_id LIMIT 100',
			);
			const details = plan.map((row) => row.detail).join(' | ');
			expect(details).toMatch(/USING (COVERING )?INDEX vp_\w+/);
			expect(details).not.toMatch(/SCAN viewer_pages\b/);
		});

		it('uses a named viewer_pages index (not a bare table scan) for a missingDescription-filtered query', async () => {
			const knex = explainArchive.getKnex();
			const plan: { detail: string }[] = await knex.raw(
				'EXPLAIN QUERY PLAN ' +
					'SELECT page_id, url_sort_key FROM viewer_pages ' +
					"WHERE is_external = 0 AND content_category IN ('html', 'unknown') AND has_description = 0 " +
					'ORDER BY url_sort_key, page_id LIMIT 100',
			);
			const details = plan.map((row) => row.detail).join(' | ');
			expect(details).toMatch(/USING (COVERING )?INDEX vp_\w+/);
			expect(details).not.toMatch(/SCAN viewer_pages\b/);
		});

		it('seeks vp_status via status_sort_key (not vp_source/vp_default) for a statusMin/statusMax range filter', async () => {
			// Regression check: filtering on the raw `status` column instead of
			// `status_sort_key` cannot seek vp_status/vp_status_desc (neither
			// index leads with `status`), so the planner falls back to whichever
			// index best matches is_external/content_category alone — see
			// apply-viewer-pages-filters.ts's comment on this predicate.
			const knex = explainArchive.getKnex();
			const plan: { detail: string }[] = await knex.raw(
				'EXPLAIN QUERY PLAN ' +
					'SELECT page_id, url_sort_key FROM viewer_pages ' +
					"WHERE is_external = 0 AND content_category IN ('html', 'unknown') " +
					'AND status_sort_key >= 400 AND status_sort_key <= 499 ' +
					'ORDER BY url_sort_key, page_id LIMIT 100',
			);
			const details = plan.map((row) => row.detail).join(' | ');
			expect(details).toMatch(/USING (COVERING )?INDEX vp_status\b/);
		});
	});
});
