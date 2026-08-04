import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeHeaderCheckInsertRows } from './compute-header-check-insert-rows.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_compute_header_checks__');

describe('computeHeaderCheckInsertRows', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-header-checks-test.nitpicker',
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

		const baseMeta = {
			lang: null,
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

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {
				'Content-Security-Policy': "default-src 'self'",
				'X-Frame-Options': 'DENY',
			},
			html: '<html></html>',
			meta: { ...baseMeta, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/no-headers')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...baseMeta, title: 'No Headers' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://external.example/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {
				'Content-Security-Policy': "default-src 'self'",
			},
			html: '',
			meta: { ...baseMeta, title: 'External' },
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

	it('computes header-presence flags and missing_count for internal HTML pages only', async () => {
		const knex = archive.getKnex();
		const rows = await computeHeaderCheckInsertRows(knex);

		expect(rows).toHaveLength(2);
		expect(rows.some((row) => row.url_sort_key.includes('external.example'))).toBe(false);

		const home = rows.find(
			(row) =>
				row.url_sort_key.includes('example.com') &&
				!row.url_sort_key.includes('no-headers'),
		);
		expect(home).toBeDefined();
		expect(home).toMatchObject({
			has_csp: 1,
			has_x_frame_options: 1,
			has_x_content_type_options: 0,
			has_hsts: 0,
			missing_count: 2,
			is_missing: 1,
		});

		const noHeaders = rows.find((row) => row.url_sort_key.includes('no-headers'));
		expect(noHeaders).toBeDefined();
		expect(noHeaders).toMatchObject({
			has_csp: 0,
			has_x_frame_options: 0,
			has_x_content_type_options: 0,
			has_hsts: 0,
			missing_count: 4,
			is_missing: 1,
		});
	});
});

/**
 * Isolated into its own archive (rather than added to the main describe
 * block's fixture) so the numeric-segment URLs don't perturb the main
 * block's `.find()`-by-substring assertions (which would otherwise also
 * match a `/page10`/`/page2` URL).
 */
describe('computeHeaderCheckInsertRows — natural_url_rank', () => {
	const naturalSortWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_header_checks_natural_sort__',
	);
	let archive: InstanceType<typeof Archive>;
	const naturalSortArchiveFilePath = path.resolve(
		naturalSortWorkingDir,
		'compute-header-checks-natural-sort-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(naturalSortWorkingDir, { recursive: true });

		archive = await Archive.create({
			filePath: naturalSortArchiveFilePath,
			cwd: naturalSortWorkingDir,
		});
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

		const baseMeta = {
			lang: null,
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

		// Seeded in an order chosen so BINARY and natural collation
		// disagree: BINARY puts '/page10' before '/page2' ('1' < '2'
		// byte-wise), natural puts '/page2' before '/page10' (2 < 10
		// numerically).
		for (const pathname of ['/page10', '/page2']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pathname}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...baseMeta, title: pathname },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(naturalSortWorkingDir, { recursive: true, force: true });
	});

	it('ranks page2 below page10 in natural (numeric-aware) order, not BINARY order', async () => {
		const knex = archive.getKnex();
		const rows = await computeHeaderCheckInsertRows(knex);
		const page2 = rows.find((row) => row.url_sort_key.endsWith('/page2'))!;
		const page10 = rows.find((row) => row.url_sort_key.endsWith('/page10'))!;
		expect(page2.natural_url_rank).toBeLessThan(page10.natural_url_rank);
	});
});
