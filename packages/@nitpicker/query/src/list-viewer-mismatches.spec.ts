import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listViewerMismatches } from './list-viewer-mismatches.js';
import { makeBeholderMeta } from './test-helpers/make-beholder-meta.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_viewer_mismatches__');

describe('listViewerMismatches', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-mismatches-test.nitpicker',
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

		// Three canonical mismatches, in a fixed url order to verify sortOrder.
		for (const pathname of ['/a1', '/a2', '/a3']) {
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
				html: '',
				meta: makeBeholderMeta({
					title: 'Title',
					link: { canonical: 'https://example.com/canonical-target' },
				}),
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		// One og:title mismatch.
		await archive.setPage({
			url: parseUrl('https://example.com/b1')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta({
				title: 'Page Title',
				og: { title: 'Different OG Title' },
			}),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// One og:description mismatch.
		await archive.setPage({
			url: parseUrl('https://example.com/c1')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta({
				description: 'Page Description',
				og: { description: 'Different OG Description' },
			}),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// No mismatch — must never appear in any type's results.
		await archive.setPage({
			url: parseUrl('https://example.com/no-mismatch')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta({
				title: 'Same',
				description: 'Same Description',
				link: { canonical: 'https://example.com/no-mismatch' },
				og: { title: 'Same', description: 'Same Description' },
			}),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists canonical mismatches ordered by url ascending', async () => {
		const result = await listViewerMismatches(archive, { type: 'canonical' });
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/a1',
			'https://example.com/a2',
			'https://example.com/a3',
		]);
		expect(result.items.every((item) => item.type === 'canonical')).toBe(true);
		expect(
			result.items.every(
				(item) => item.expected === 'https://example.com/canonical-target',
			),
		).toBe(true);
		expect(result.total).toBe(3);
	});

	it('sorts descending when sortOrder is desc', async () => {
		const result = await listViewerMismatches(archive, {
			type: 'canonical',
			sortOrder: 'desc',
		});
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/a3',
			'https://example.com/a2',
			'https://example.com/a1',
		]);
	});

	it('lists og:title mismatches', async () => {
		const result = await listViewerMismatches(archive, { type: 'og:title' });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toEqual({
			url: 'https://example.com/b1',
			type: 'og:title',
			actual: 'Different OG Title',
			expected: 'Page Title',
		});
	});

	it('lists og:description mismatches', async () => {
		const result = await listViewerMismatches(archive, { type: 'og:description' });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toEqual({
			url: 'https://example.com/c1',
			type: 'og:description',
			actual: 'Different OG Description',
			expected: 'Page Description',
		});
	});

	it('filters by an array of types, OR-ing them together, with the row-level type preserved per entry', async () => {
		const result = await listViewerMismatches(archive, {
			type: ['og:title', 'og:description'],
		});
		expect(result.total).toBe(2);
		expect(result.items.map((item) => item.type).toSorted()).toEqual([
			'og:description',
			'og:title',
		]);
	});

	it('lists every type when type is omitted', async () => {
		const result = await listViewerMismatches(archive, {});
		expect(result.total).toBe(5);
	});

	it('lists every type when type is an empty array', async () => {
		const result = await listViewerMismatches(archive, { type: [] });
		expect(result.total).toBe(5);
	});

	it('filters by urlPattern with a plain LIKE against the inlined URL', async () => {
		const result = await listViewerMismatches(archive, { urlPattern: '%/a1%' });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/a1');
	});

	it('combines urlPattern with a type filter', async () => {
		const result = await listViewerMismatches(archive, {
			type: 'canonical',
			urlPattern: '%/a2%',
		});
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/a2');
	});

	it('rejects a cursor minted under a different urlPattern', async () => {
		const page1 = await listViewerMismatches(archive, {
			type: 'canonical',
			urlPattern: '%example%',
			limit: 1,
		});
		expect(page1.nextCursor).not.toBeNull();
		await expect(
			listViewerMismatches(archive, {
				type: 'canonical',
				urlPattern: '%other%',
				cursor: page1.nextCursor!,
			}),
		).rejects.toThrow();
	});

	it('paginates forward via nextCursor and matches an equivalent offset read', async () => {
		const page1 = await listViewerMismatches(archive, { type: 'canonical', limit: 2 });
		expect(page1.items.map((item) => item.url)).toEqual([
			'https://example.com/a1',
			'https://example.com/a2',
		]);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listViewerMismatches(archive, {
			type: 'canonical',
			limit: 2,
			cursor: page1.nextCursor!,
		});
		expect(page2.items.map((item) => item.url)).toEqual(['https://example.com/a3']);
		expect(page2.nextCursor).toBeNull();

		const offsetPage2 = await listViewerMismatches(archive, {
			type: 'canonical',
			limit: 2,
			offset: 2,
		});
		expect(offsetPage2.items).toEqual(page2.items);
	});

	it('paginates backward via prevCursor', async () => {
		const page2 = await listViewerMismatches(archive, {
			type: 'canonical',
			limit: 2,
			offset: 2,
		});
		expect(page2.prevCursor).not.toBeNull();

		const page1 = await listViewerMismatches(archive, {
			type: 'canonical',
			limit: 2,
			cursor: page2.prevCursor!,
			direction: 'prev',
		});
		expect(page1.items.map((item) => item.url)).toEqual([
			'https://example.com/a1',
			'https://example.com/a2',
		]);
	});

	it('rejects a cursor minted under a different type', async () => {
		const page1 = await listViewerMismatches(archive, { type: 'canonical', limit: 2 });
		await expect(
			listViewerMismatches(archive, {
				type: 'og:title',
				limit: 2,
				cursor: page1.nextCursor!,
			}),
		).rejects.toThrow(/does not match/);
	});
});

/**
 * Isolated into its own archive (rather than added to the main describe
 * block's fixture) so the numeric-segment URLs don't perturb the main
 * block's exact item counts and pagination-offset assumptions.
 */
describe('listViewerMismatches — url sort: unset (BINARY) vs explicit "url" (natural)', () => {
	const naturalSortWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_viewer_mismatches_natural_sort__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		naturalSortWorkingDir,
		'list-viewer-mismatches-natural-sort-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(naturalSortWorkingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
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

		// Two canonical mismatches with numeric-segment URLs, seeded in an
		// order chosen so BINARY and natural collation disagree: BINARY
		// puts '/page10' before '/page2' ('1' < '2' byte-wise), natural puts
		// '/page2' before '/page10' (2 < 10 numerically).
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
				html: '',
				meta: makeBeholderMeta({
					title: 'Title',
					link: { canonical: 'https://example.com/canonical-target' },
				}),
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(naturalSortWorkingDir, { recursive: true, force: true });
	});

	it('orders page2 before page10 when sortBy is explicitly "url" (natural order)', async () => {
		const result = await listViewerMismatches(archive, {
			type: 'canonical',
			sortBy: 'url',
		});
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/page2',
			'https://example.com/page10',
		]);
	});

	it('orders page10 before page2 when sortBy is unset (BINARY order)', async () => {
		const result = await listViewerMismatches(archive, { type: 'canonical' });
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/page10',
			'https://example.com/page2',
		]);
	});

	it('sorts by "actual" ascending', async () => {
		const result = await listViewerMismatches(archive, {
			type: 'canonical',
			sortBy: 'actual',
		});
		// `actual` equals the page's own URL for canonical mismatches, so
		// ascending "actual" order is the same BINARY order as the unset-sortBy
		// case above — this exercises the independent `actual`-column sort
		// path (`getMismatchesSortSpec`'s `'actual'` branch), not a
		// coincidence of the URL sort.
		expect(result.items.map((item) => item.actual)).toEqual([
			'https://example.com/page10',
			'https://example.com/page2',
		]);
	});
});
