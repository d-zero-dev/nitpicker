import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';

import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

import { matchSelector } from './match-selector.js';
import { UnsupportedSelectorError } from './unsupported-selector-error.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_match_selector__',
);

const SHARED_HTML =
	'<html><head><title>T</title></head><body><nav class="main"><a href="/products/1">P</a></nav><ul><li>1</li><li>2</li></ul></body></html>';
const SKIPPED_HTML = '<html><body><p class="only-in-skipped-page"></p></body></html>';
const OTHER_HTML =
	'<html><body><template><img></template><p><img alt=""></p></body></html>';

describe('matchSelector', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		// Crawl order interleaves the two snapshots (A, B, A) so that page-id order
		// cannot be mistaken for snapshot-hash order.
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'match-selector.nitpicker',
			pages: [
				{ url: 'https://example.com', html: SHARED_HTML },
				{ url: 'https://example.com/blog/post', html: OTHER_HTML },
				{ url: 'https://example.com/about', html: SHARED_HTML },
				{ url: 'https://example.com/doc.pdf', html: '', contentType: 'application/pdf' },
				{ url: 'https://example.com/excluded', html: SKIPPED_HTML, isSkipped: true },
			],
		});
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns every page of a matching snapshot, in page-id order', async () => {
		const result = await matchSelector(archive, {
			selector: 'nav a[href^="/products/"]',
		});
		expect(result.selector).toBe('nav a[href^="/products/"]');
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com',
			'https://example.com/about',
		]);
		expect(result.total).toBe(2);
		expect(result.matchedSnapshots).toBe(1);
		expect(result).toMatchObject({ limit: 100, offset: 0 });
	});

	it('judges identical HTML once and counts only pages that have a snapshot', async () => {
		const result = await matchSelector(archive, { selector: 'article' });
		expect(result.total).toBe(0);
		expect(result.items).toEqual([]);
		expect(result.scannedSnapshots).toBe(2);
		expect(result.candidatePages).toBe(3);
	});

	it('does not search the snapshot of an excluded page', async () => {
		// precondition: the excluded page really has a stored snapshot
		const [stored] = await archive
			.getKnex()('page_html_ref as phr')
			.join('content_items as ci', 'ci.id', 'phr.page_id')
			.where('ci.is_skipped', 1)
			.count({ count: '*' });
		expect(Number(stored!.count)).toBe(1);

		const result = await matchSelector(archive, { selector: '.only-in-skipped-page' });
		expect(result).toMatchObject({ total: 0, scannedSnapshots: 2, candidatePages: 3 });
	});

	it('does not search <template> content', async () => {
		const result = await matchSelector(archive, { selector: 'template img' });
		expect(result.total).toBe(0);
		const direct = await matchSelector(archive, { selector: 'img' });
		expect(direct.items.map((item) => item.url)).toEqual([
			'https://example.com/blog/post',
		]);
	});

	it('supports sibling-position selectors', async () => {
		const result = await matchSelector(archive, { selector: 'ul > li:nth-child(2)' });
		expect(result.total).toBe(2);
		const none = await matchSelector(archive, { selector: 'ul > li:nth-child(3)' });
		expect(none.total).toBe(0);
	});

	it('answers a single-compound selector without the open-element stack', async () => {
		// The second snapshot has no `<li`, so the prefilter rejects it before any scan.
		const result = await matchSelector(archive, { selector: 'li' });
		expect(result).toMatchObject({
			total: 2,
			prefilteredSnapshots: 1,
			tokenizedSnapshots: 0,
		});
	});

	it('uses the prefilter to skip snapshots that lack a required literal', async () => {
		const result = await matchSelector(archive, { selector: 'nav a' });
		expect(result).toMatchObject({
			total: 2,
			scannedSnapshots: 2,
			prefilteredSnapshots: 1,
			tokenizedSnapshots: 1,
		});
	});

	it('reads every snapshot when the selector cannot be prefiltered', async () => {
		const result = await matchSelector(archive, { selector: ':not(.x) > :not(.y)' });
		expect(result.prefilteredSnapshots).toBe(0);
		expect(result.tokenizedSnapshots).toBe(2);
	});

	it('matches a selector list across both stages', async () => {
		const result = await matchSelector(archive, { selector: 'img, nav a' });
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com',
			'https://example.com/blog/post',
			'https://example.com/about',
		]);
	});

	it('narrows the scan to the pages matching urlPattern', async () => {
		const result = await matchSelector(archive, {
			selector: 'nav a',
			urlPattern: '%/about',
		});
		expect(result.items.map((item) => item.url)).toEqual(['https://example.com/about']);
		expect(result).toMatchObject({
			total: 1,
			candidatePages: 1,
			scannedSnapshots: 1,
			matchedSnapshots: 1,
		});
	});

	it('narrows the scan to the pages under directory', async () => {
		// The shared snapshot also matches `nav a, img`, but no page under /blog references it.
		const result = await matchSelector(archive, {
			selector: 'nav a, img',
			directory: '/blog',
		});
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com/blog/post',
		]);
		expect(result).toMatchObject({
			total: 1,
			candidatePages: 1,
			scannedSnapshots: 1,
			matchedSnapshots: 1,
		});
	});

	it('slices with offset / limit and returns only counts for limit 0', async () => {
		const page2 = await matchSelector(archive, { selector: 'li', limit: 1, offset: 1 });
		expect(page2.items).toHaveLength(1);
		expect(page2.items.map((item) => item.url)).toEqual(['https://example.com/about']);
		expect(page2).toMatchObject({ total: 2, limit: 1, offset: 1 });
		const countOnly = await matchSelector(archive, { selector: 'li', limit: 0 });
		expect(countOnly.items).toEqual([]);
		expect(countOnly.total).toBe(2);
	});

	it('reports progress once per scanned chunk', async () => {
		const messages: string[] = [];
		await matchSelector(archive, {
			selector: 'li',
			onProgress: (message) => messages.push(message),
		});
		expect(messages).toEqual(['Scanning HTML snapshots: 2 / 2']);
	});

	it('rejects an unsupported selector before touching the archive', async () => {
		const untouchable = {
			getKnex() {
				throw new Error('the archive was opened');
			},
		} as unknown as ArchiveAccessor;
		await expect(matchSelector(untouchable, { selector: 'a + b' })).rejects.toThrow(
			UnsupportedSelectorError,
		);
	});

	it('returns nothing for an archive without HTML snapshots', async () => {
		const emptyDir = path.resolve(workingDir, 'no-html');
		const empty = await createHtmlSelectorFixtureArchive({
			workingDir: emptyDir,
			fileName: 'empty.nitpicker',
			pages: [
				{ url: 'https://example.com/doc.pdf', html: '', contentType: 'application/pdf' },
			],
		});
		const messages: string[] = [];
		try {
			const result = await matchSelector(empty, {
				selector: 'a',
				onProgress: (message) => messages.push(message),
			});
			expect(result).toMatchObject({
				total: 0,
				items: [],
				scannedSnapshots: 0,
				candidatePages: 0,
			});
			expect(messages).toEqual([]);
		} finally {
			await empty.close();
		}
	});
});
