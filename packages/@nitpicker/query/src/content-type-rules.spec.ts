import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { classifyContentType } from './classify-content-type.js';
import { applyCategoryFilter, CONTENT_TYPE_RULES } from './content-type-rules.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

/**
 * MIMEs that exercise every category edge case we care about — overlap
 * cases (image/svg+xml, application/xhtml+xml, text/calendar+xml,
 * text/x-foo+json), each positive rule, the `text/` catch-all, an `other`
 * residual, and the unknown bucket (null).
 *
 * Empty / blank strings are intentionally omitted: the crawler's
 * `normalizeContentType` collapses them to NULL before they reach the DB,
 * so a fixture of `''` would round-trip as `null` and make the JS-vs-SQL
 * test comparison rely on string→null coercion. The SQL `unknown` matcher
 * still has an `OR contentType = ''` defensive clause; that branch is
 * exercised by `applyCategoryFilter unit test` below (which builds an
 * isolated query rather than going through the writer).
 */
const FIXTURE_MIMES: readonly (string | null)[] = [
	null,
	'text/html',
	'application/xhtml+xml',
	'application/pdf',
	'text/csv',
	'application/csv',
	'text/tab-separated-values',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.ms-powerpoint',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'image/png',
	'image/svg+xml',
	'audio/mpeg',
	'video/mp4',
	'font/woff2',
	'application/font-woff',
	'application/vnd.ms-fontobject',
	'text/css',
	'text/javascript',
	'application/javascript',
	'application/x-javascript',
	'application/ecmascript',
	'application/json',
	'application/ld+json',
	'application/yaml',
	'text/yaml',
	'application/x-yaml',
	'application/xml',
	'text/xml',
	'application/atom+xml',
	'application/zip',
	'application/octet-stream',
	'text/plain',
	'text/markdown',
	'text/calendar+xml',
	'text/x-foo+json',
	'application/vnd.example.unknown',
	'multipart/form-data',
];

describe('CONTENT_TYPE_RULES is the single source of truth', () => {
	it('CONTENT_TYPE_RULES order encodes JS classifier precedence', () => {
		// If someone reorders rules they MUST update this expectation — order is
		// what makes `image/svg+xml → 'image'` and `application/xhtml+xml → 'html'`
		// work; the SQL matcher's "negate earlier rules" loop assumes this.
		const order = CONTENT_TYPE_RULES.map((r) => r.category);
		expect(order).toEqual([
			'html',
			'pdf',
			'csv',
			'word',
			'excel',
			'powerpoint',
			'image',
			'audio',
			'video',
			'font',
			'css',
			'javascript',
			'json',
			'xml',
			'archive',
			'text',
		]);
	});

	it('overlap-prone MIMEs route by precedence (image+svg wins over xml; xhtml wins over xml; text+xml wins over text)', () => {
		// These are the exact bugs the review flagged. classifyContentType MUST
		// agree with the SQL matcher (asserted by the integration tests below).
		expect(classifyContentType('image/svg+xml')).toBe('image');
		expect(classifyContentType('application/xhtml+xml')).toBe('html');
		expect(classifyContentType('text/calendar+xml')).toBe('xml');
		expect(classifyContentType('text/x-foo+json')).toBe('json');
	});
});

describe('applyCategoryFilter spot-checks (hardcoded expected URLs for known-overlap MIMEs)', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_content_type_spot__');
	const archiveFilePath = path.resolve(dir, 'content-type-spot.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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
		// Hardcoded URL→MIME mapping for the known-overlap cases the bugfix is
		// supposed to address. Each it() below asserts a fixed URL is or isn't in
		// the filtered set — no derived expected values from the JS classifier.
		const fixtures: { url: string; mime: string }[] = [
			{ url: 'https://example.com/svg', mime: 'image/svg+xml' },
			{ url: 'https://example.com/xhtml', mime: 'application/xhtml+xml' },
			{ url: 'https://example.com/cal', mime: 'text/calendar+xml' },
			{ url: 'https://example.com/api', mime: 'text/x-foo+json' },
			{ url: 'https://example.com/page', mime: 'text/html' },
			{ url: 'https://example.com/doc', mime: 'application/pdf' },
		];
		for (const f of fixtures) {
			await archive.setPage({
				url: parseUrl(f.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: f.mime,
				contentLength: 0,
				responseHeaders: {},
				html: '',
				meta: {
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
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	const urlsFor = async (
		category: 'html' | 'image' | 'xml' | 'json' | 'text' | 'pdf',
	) => {
		const query = archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.select('ur.url as url')
			.where('ci.scraped', 1);
		applyCategoryFilter(query, category);
		const rows = (await query) as { url: string }[];
		return rows.map((r) => r.url).toSorted();
	};

	it('image/svg+xml is bucketed under image, never xml — the SVG-via-+xml-suffix overlap bug', async () => {
		// Image filter contains the SVG row. xml filter does NOT contain it
		// (it contains text/calendar+xml — but explicitly NOT image/svg+xml).
		expect(await urlsFor('image')).toEqual(['https://example.com/svg']);
		expect(await urlsFor('xml')).not.toContain('https://example.com/svg');
	});

	it('application/xhtml+xml is bucketed under html, never xml — the XHTML overlap bug', async () => {
		expect(await urlsFor('html')).toEqual([
			'https://example.com/page',
			'https://example.com/xhtml',
		]);
		expect(await urlsFor('xml')).not.toContain('https://example.com/xhtml');
	});

	it('text/calendar+xml is bucketed under xml, never text — +xml suffix wins over text/ prefix', async () => {
		expect(await urlsFor('xml')).toEqual(['https://example.com/cal']);
		expect(await urlsFor('text')).not.toContain('https://example.com/cal');
	});

	it('text/x-foo+json is bucketed under json, never text — +json suffix wins over text/ prefix', async () => {
		expect(await urlsFor('json')).toEqual(['https://example.com/api']);
		expect(await urlsFor('text')).not.toContain('https://example.com/api');
	});

	it('application/pdf is reachable through the pdf filter (the use case for adding this filter)', async () => {
		expect(await urlsFor('pdf')).toEqual(['https://example.com/doc']);
	});
});

describe('applyCategoryFilter unit test (raw SQL injection for the empty-string defensive branch)', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_content_type_empty__');
	const archiveFilePath = path.resolve(dir, 'content-type-empty.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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
		// Bypass the writer's normalisation so we can pin an actual `contentType = ''`
		// row in the DB. This exercises the `unknown` matcher's `OR contentType = ''`
		// branch directly — pre-normalisation archives or future writer bypasses
		// would produce this exact shape.
		const knex = archive.getKnex();
		await knex('pages').insert({
			url: 'https://example.com/empty-mime',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			status: 200,
			contentType: '',
		});
		await knex('pages').insert({
			url: 'https://example.com/null-mime',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			status: 200,
			contentType: null,
		});
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('unknown filter matches BOTH NULL and empty-string contentType', async () => {
		// JS classifier returns 'unknown' for both; the SQL matcher must agree
		// even though the crawler normally collapses '' → NULL on write.
		const query = archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.select('ur.url as url')
			.where('ci.scraped', 1);
		applyCategoryFilter(query, 'unknown');
		const rows = (await query) as { url: string }[];
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/empty-mime',
			'https://example.com/null-mime',
		]);
	});

	it('other filter excludes both NULL and empty-string contentType (they belong to unknown, not other)', async () => {
		const query = archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.select('ur.url as url')
			.where('ci.scraped', 1);
		applyCategoryFilter(query, 'other');
		const rows = (await query) as { url: string }[];
		expect(rows).toEqual([]);
	});
});

describe('applyCategoryFilter (SQL) agrees with classifyContentType (JS) on every fixture MIME', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_content_type_rules__');
	const archiveFilePath = path.resolve(dir, 'content-type-rules.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
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

		// One URL per fixture MIME. We intentionally bypass `normalizeContentType`
		// for the empty-string case so the SQL `unknown` matcher's coverage of
		// `contentType = ''` (added in this fix) is exercised even though the
		// crawler normally collapses '' → NULL.
		let i = 0;
		for (const mime of FIXTURE_MIMES) {
			await archive.setPage({
				url: parseUrl(`https://example.com/fixture-${i}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: mime,
				contentLength: 0,
				responseHeaders: {},
				html: '',
				meta: {
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
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			i++;
		}
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	const categories = [
		...CONTENT_TYPE_RULES.map((r) => r.category),
		'other' as const,
		'unknown' as const,
	];

	for (const category of categories) {
		it(`SQL category="${category}" returns exactly the MIMEs that classifyContentType buckets as "${category}"`, async () => {
			const knex = archive.getKnex();
			const query = knex('content_items as ci')
				.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
				.select('ctr.raw as contentType')
				.where('ci.scraped', 1);
			applyCategoryFilter(query, category);
			const rows = (await query) as { contentType: string | null }[];
			const sqlMatched = new Set(rows.map((r) => r.contentType));

			const jsMatched = new Set(
				FIXTURE_MIMES.filter((m) => classifyContentType(m) === category),
			);

			// Symmetric difference (would be empty if SQL and JS agree exactly).
			const jsNotSql = [...jsMatched].filter((m) => !sqlMatched.has(m));
			const sqlNotJs = [...sqlMatched].filter((m) => !jsMatched.has(m));
			expect({ category, jsNotSql, sqlNotJs }).toEqual({
				category,
				jsNotSql: [],
				sqlNotJs: [],
			});
		});
	}

	it('categories partition the fixture set (every row matches exactly one category filter)', async () => {
		const knex = archive.getKnex();
		// Key by url (unique per fixture) — keying by contentType would collapse
		// the two distinct rows that share contentType=null (null + '' both
		// normalise to NULL on write) and false-positive the partition check.
		const matchCounts = new Map<string, number>();
		for (const category of categories) {
			const query = knex('content_items as ci')
				.join('url_refs as ur', 'ur.id', 'ci.url_id')
				.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
				.select('ur.url as url')
				.where('ci.scraped', 1);
			applyCategoryFilter(query, category);
			const rows = (await query) as { url: string }[];
			for (const row of rows) {
				matchCounts.set(row.url, (matchCounts.get(row.url) ?? 0) + 1);
			}
		}
		// Every fixture row must have been matched by exactly one category.
		const offenders = [...matchCounts.entries()].filter(([, n]) => n !== 1);
		expect(offenders).toEqual([]);
	});
});
