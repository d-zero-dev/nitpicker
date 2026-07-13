import type { DomPathResult } from './types.js';
import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populatePhase6BRefs } from '../phase6b/populate-phase6b-refs.js';

import { populateContentItems } from './populate-content-items.js';
import { populateImageItems } from './populate-image-items.js';
import { countRows } from './test-utils/count-rows.js';
import { setupPhase6DDb } from './test-utils/setup-phase6d-db.js';

/**
 * Builds an `unknown/<id>` resolver — every image gets the synthetic
 * fallback path. Kept non-async because the eslint
 * `@typescript-eslint/require-await` rule bans `async` bodies with no
 * `await`; `Promise.resolve` produces the same `Promise<...>` return
 * type the `PageDomPathResolver` contract in `populate-image-items.ts`
 * requires.
 * @param images - The image rows passed by the caller.
 */
function unknownResolver(
	images: readonly { id: number }[],
): Promise<ReadonlyMap<number, DomPathResult>> {
	const map = new Map<number, DomPathResult>();
	for (const image of images) {
		map.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
	}
	return Promise.resolve(map);
}

describe('populateImageItems', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('routes plain-URL src to src_url_id and data-URI to src_blob_id', async () => {
		const longDataUri = 'data:image/png;base64,' + 'A'.repeat(600);
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
		]);
		await db('images').insert([
			{
				id: 10,
				pageId: 1,
				src: 'https://example.com/img.png',
				currentSrc: 'https://example.com/img.png',
				alt: 'alt text',
				width: 100,
				height: 50,
				naturalWidth: 200,
				naturalHeight: 100,
				isLazy: 0,
				viewportWidth: 1280,
				sourceCode: '<img src="https://example.com/img.png">',
			},
			{
				id: 20,
				pageId: 1,
				src: longDataUri,
				currentSrc: longDataUri,
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1280,
				sourceCode: null,
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populateImageItems(
			db,
			(_pageId, _html, images) => unknownResolver(images),
			() => Promise.resolve(null),
		);
		const rows = await db('image_items').select().orderBy('id');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.id).toBe(10);
		expect(rows[0]!.src_url_id).not.toBeNull();
		expect(rows[0]!.src_blob_id).toBeNull();
		expect(rows[0]!.alt_text_id).not.toBeNull();
		expect(rows[1]!.id).toBe(20);
		expect(rows[1]!.src_url_id).toBeNull();
		expect(rows[1]!.src_blob_id).not.toBeNull();
	});

	it('inserts dom_path strings into text_refs and links image_items.dom_path_text_id', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
		]);
		await db('images').insert([
			{
				id: 5,
				pageId: 1,
				src: 'https://example.com/img.png',
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: '<img src="https://example.com/img.png">',
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		const singleMatchResolver = (
			_pageId: number,
			_html: string | null,
			images: readonly { id: number }[],
		): Promise<ReadonlyMap<number, DomPathResult>> => {
			const map = new Map<number, DomPathResult>();
			for (const image of images) {
				map.set(image.id, {
					path: 'html/body[1]/main[1]/img[1]',
					case: 'single-match',
				});
			}
			return Promise.resolve(map);
		};
		await populateImageItems(db, singleMatchResolver, () => Promise.resolve(null));
		const row = await db('image_items').where('id', 5).first();
		const domPathText = await db('text_refs').where('id', row.dom_path_text_id).first();
		expect(domPathText.text).toBe('html/body[1]/main[1]/img[1]');
	});

	it('processes each page as one unit — dom-path resolver is called once per page', async () => {
		// Regression guard for the earlier image-chunked implementation
		// that reset `matchImagesToDomPaths`' ordinal cursor at each
		// READ_CHUNK_SIZE boundary and duplicated dom_paths.
		// Iterating by pageId means the resolver sees every image of a
		// page in one call regardless of how many rows the page has.
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		const bulk = Array.from({ length: 20 }, (_, index) => ({
			pageId: 1,
			src: 'https://example.com/logo.png',
			alt: null,
			width: 1,
			height: 1,
			naturalWidth: 1,
			naturalHeight: 1,
			isLazy: 0,
			viewportWidth: 1,
			sourceCode: `<img src="https://example.com/logo.png" data-idx="${index}">`,
		}));
		await db('images').insert([
			...bulk,
			{
				pageId: 2,
				src: 'https://example.com/other.png',
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: '<img src="https://example.com/other.png">',
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		const resolverCalls: number[] = [];
		const resolver = (
			pageId: number,
			_html: string | null,
			images: readonly { id: number }[],
		): Promise<ReadonlyMap<number, DomPathResult>> => {
			resolverCalls.push(pageId);
			const map = new Map<number, DomPathResult>();
			for (const image of images) {
				map.set(image.id, { path: `html/body[1]/img[${image.id}]`, case: 'unknown' });
			}
			return Promise.resolve(map);
		};
		await populateImageItems(db, resolver, () => Promise.resolve(null));
		// Each pageId visited exactly once.
		expect(resolverCalls.toSorted()).toEqual([1, 2]);
		expect(await countRows(db, 'image_items')).toBe(21);
	});

	it('does not send data URIs into url_refs lookups (routing partition)', async () => {
		// Regression guard for the earlier bug that added every value to
		// both `urls` and `dataUris` sets — large data URIs must never
		// reach `resolveUrlRefs`' `WHERE url IN (?)` because they can
		// blow past SQLITE_MAX_SQL_LENGTH.
		const longDataUri = 'data:image/png;base64,' + 'A'.repeat(600);
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
		]);
		await db('images').insert([
			{
				id: 1,
				pageId: 1,
				src: longDataUri,
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: null,
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		await populateImageItems(
			db,
			(_pageId, _html, images) => unknownResolver(images),
			() => Promise.resolve(null),
		);
		// The data URI must land in blob_refs, not url_refs. `url_refs`
		// should not contain the data URI (populateUrlRefs already
		// filtered it out; this just guards against a future regression
		// where populateImageItems tries to insert it opportunistically).
		const urlRefRow = await db('url_refs').where('url', longDataUri).first();
		expect(urlRefRow).toBeUndefined();
		const image = await db('image_items').where('id', 1).first();
		expect(image.src_url_id).toBeNull();
		expect(image.src_blob_id).not.toBeNull();
	});

	it('is idempotent', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
		]);
		await db('images').insert([
			{
				id: 1,
				pageId: 1,
				src: 'https://example.com/x.png',
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: '<img src="https://example.com/x.png">',
			},
		]);
		await populatePhase6BRefs(db);
		await populateContentItems(db);
		const resolver = (
			_pageId: number,
			_html: string | null,
			images: readonly { id: number }[],
		): Promise<ReadonlyMap<number, DomPathResult>> => unknownResolver(images);
		await populateImageItems(db, resolver, () => Promise.resolve(null));
		await populateImageItems(db, resolver, () => Promise.resolve(null));
		expect(await countRows(db, 'image_items')).toBe(1);
	});
});
