import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { listViewerHeaderChecks } from './list-viewer-header-checks.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_viewer_header_checks__');

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

describe('listViewerHeaderChecks', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-header-checks-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
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
		});

		for (const [pathname, headers] of [
			[
				'/a',
				{
					'Content-Security-Policy': "default-src 'self'",
					'X-Frame-Options': 'DENY',
					'X-Content-Type-Options': 'nosniff',
					'Strict-Transport-Security': 'max-age=63072000',
				},
			],
			['/b', {}],
			['/c', { 'Content-Security-Policy': "default-src 'self'" }],
		] as const) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pathname}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: headers,
				html: '',
				meta: { ...META, title: pathname },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await buildViewerReadModel(archive);
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists every header check ordered by url ascending', async () => {
		const result = await listViewerHeaderChecks(archive);
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/c',
		]);
		expect(result.total).toBe(3);
	});

	it('filters to pages missing at least one tracked header with missingOnly', async () => {
		const result = await listViewerHeaderChecks(archive, { missingOnly: true });
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/b',
			'https://example.com/c',
		]);
	});

	it('filters by an individual header-presence flag set to true', async () => {
		const result = await listViewerHeaderChecks(archive, { hasXFrameOptions: true });
		expect(result.items.map((item) => item.url)).toEqual(['https://example.com/a']);
	});

	it('filters by an individual header-presence flag explicitly set to false', async () => {
		const result = await listViewerHeaderChecks(archive, { hasXFrameOptions: false });
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/b',
			'https://example.com/c',
		]);
	});

	it('paginates forward via nextCursor and matches an equivalent offset read', async () => {
		const page1 = await listViewerHeaderChecks(archive, { limit: 2 });
		expect(page1.items.map((item) => item.url)).toEqual([
			'https://example.com/a',
			'https://example.com/b',
		]);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listViewerHeaderChecks(archive, {
			limit: 2,
			cursor: page1.nextCursor!,
		});
		expect(page2.items.map((item) => item.url)).toEqual(['https://example.com/c']);
		expect(page2.nextCursor).toBeNull();

		const offsetPage2 = await listViewerHeaderChecks(archive, { limit: 2, offset: 2 });
		expect(offsetPage2.items).toEqual(page2.items);
	});

	it('paginates backward via prevCursor', async () => {
		const page2 = await listViewerHeaderChecks(archive, { limit: 2, offset: 2 });
		expect(page2.prevCursor).not.toBeNull();

		const page1 = await listViewerHeaderChecks(archive, {
			limit: 2,
			cursor: page2.prevCursor!,
			direction: 'prev',
		});
		expect(page1.items.map((item) => item.url)).toEqual([
			'https://example.com/a',
			'https://example.com/b',
		]);
	});

	describe('EXPLAIN QUERY PLAN', () => {
		// A dedicated, larger (500-row) synthetic fixture — see
		// `list-viewer-pages.spec.ts`'s identical rationale: an 8-row archive
		// is too small for SQLite's planner (no ANALYZE, per this repo's
		// standing rule) to reliably prefer an index seek over a scan.
		const explainWorkingDir = path.resolve(
			__dirname,
			'__test_fixtures_list_viewer_header_checks_explain__',
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
			await explainArchive.setConfig({
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
			});

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
				html: '',
				meta: { ...META, title: 'Seed' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			await buildViewerReadModel(explainArchive);

			const knex = explainArchive.getKnex();
			const rows = Array.from({ length: 500 }, (_, i) => {
				const isMissing = i % 3 === 0 ? 1 : 0;
				return {
					page_id: i + 1000,
					url_sort_key: `https://example.com/page-${i}`,
					has_csp: isMissing ? 0 : 1,
					has_x_frame_options: 1,
					has_x_content_type_options: 1,
					has_hsts: 1,
					missing_count: isMissing ? 1 : 0,
					is_missing: isMissing,
				};
			});
			await knex('viewer_header_checks').insert(rows);
		});

		afterAll(async () => {
			if (explainArchive) {
				await explainArchive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(explainWorkingDir, { recursive: true, force: true });
		});

		it('uses vh_default (not a bare table scan) for the unfiltered default query', async () => {
			const knex = explainArchive.getKnex();
			const plan: { detail: string }[] = await knex.raw(
				'EXPLAIN QUERY PLAN ' +
					'SELECT page_id, url_sort_key FROM viewer_header_checks ' +
					'ORDER BY url_sort_key, page_id LIMIT 100',
			);
			const details = plan.map((row) => row.detail).join(' | ');
			expect(details).toMatch(/USING (COVERING )?INDEX vh_\w+/);
			expect(details).not.toMatch(/TEMP B-TREE/);
		});

		it('uses vh_missing (not a temp b-tree sort) for the missingOnly query — regression test for issue #119 xhigh review finding', async () => {
			const knex = explainArchive.getKnex();
			const plan: { detail: string }[] = await knex.raw(
				'EXPLAIN QUERY PLAN ' +
					'SELECT page_id, url_sort_key FROM viewer_header_checks ' +
					'WHERE is_missing = 1 ' +
					'ORDER BY url_sort_key, page_id LIMIT 100',
			);
			const details = plan.map((row) => row.detail).join(' | ');
			expect(details).toMatch(/USING (COVERING )?INDEX vh_missing/);
			expect(details).not.toMatch(/TEMP B-TREE/);
		});
	});
});
