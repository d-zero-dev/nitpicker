import type { Database } from './database.js';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ArchiveAccessor } from './archive-accessor.js';
import Archive from './archive.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_archive_accessor__');

/**
 * `getHtmlOfPage` is the single read path used by all consumers (analyze,
 * report, viewer, MCP). After #75 it is a straight join over
 * `page_html_ref` → `page_html_blobs` with inline zstd decompression: there
 * is no longer a filesystem fallback chain. These tests pin that contract.
 */
describe('ArchiveAccessor.getHtmlOfPage', () => {
	const archiveBasename = 'getHtmlOfPage-test';
	const archiveFilePath = path.resolve(workingDir, `${archiveBasename}.nitpicker`);
	let archive: Archive;

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
	});

	afterAll(async () => {
		await archive.releaseHandle();
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('Returns the stored HTML body for a page id with a snapshot', async () => {
		const pageId = await archive.setPage({
			url: parseUrl('http://localhost/with-html')!,
			redirectPaths: [],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 13,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'with html' },
			anchorList: [],
			imageList: [],
			html: '<p>stored</p>',
			isSkipped: false,
			isTarget: true,
		});
		const html = await archive.getHtmlOfPage(pageId);
		expect(html).toBe('<p>stored</p>');
	});

	it('Returns null for a page id with no stored snapshot', async () => {
		// 9999 is not in pages — accessor must return null instead of
		// throwing so callers can render "snapshot unavailable" UI.
		const html = await archive.getHtmlOfPage(9999);
		expect(html).toBeNull();
	});

	it('Returns null for an external/metadata-only page (writeHtml=false)', async () => {
		// setExternalPage stores meta but never an HTML body. The read path
		// must therefore return null rather than throwing on a missing
		// page_html_ref row.
		await archive.setExternalPage({
			url: parseUrl('http://external.example.com/x')!,
			redirectPaths: [],
			isExternal: true,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: '' },
			anchorList: [],
			imageList: [],
			html: '',
			isSkipped: false,
			isTarget: false,
		});
		const knex = archive.getKnex();
		const [page] = await knex('content_items')
			.join('url_refs', 'content_items.url_id', 'url_refs.id')
			.select('content_items.id as id')
			.where('url_refs.url', 'http://external.example.com/x');
		const html = await archive.getHtmlOfPage(page.id);
		expect(html).toBeNull();
	});

	it('Identical bodies across pages share a single blob row (within-crawl dedup)', async () => {
		// Two distinct pages with identical HTML must produce exactly one
		// NEW page_html_blobs row (PK = sha256(body)) and two ref rows
		// pointing at the same hash. The blob-count delta is checked
		// relative to a baseline so the assertion does not depend on what
		// other tests in this describe block left behind.
		const knex = archive.getKnex();
		const baselineRow = await knex('page_html_blobs')
			.count<{ count: number }[]>('* as count')
			.first();
		const baseline = Number(baselineRow?.count ?? 0);

		const sharedBody = '<!doctype html><title>404</title>';
		const aId = await archive.setPage({
			url: parseUrl('http://localhost/dup-a')!,
			redirectPaths: [],
			isExternal: false,
			status: 404,
			statusText: 'Not Found',
			contentLength: sharedBody.length,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: '' },
			anchorList: [],
			imageList: [],
			html: sharedBody,
			isSkipped: false,
			isTarget: true,
		});
		const bId = await archive.setPage({
			url: parseUrl('http://localhost/dup-b')!,
			redirectPaths: [],
			isExternal: false,
			status: 404,
			statusText: 'Not Found',
			contentLength: sharedBody.length,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: '' },
			anchorList: [],
			imageList: [],
			html: sharedBody,
			isSkipped: false,
			isTarget: true,
		});

		const refRows: { page_id: number; hash: Uint8Array }[] = await knex('page_html_ref')
			.select('page_id', 'hash')
			.whereIn('page_id', [aId, bId]);
		expect(refRows).toHaveLength(2);
		// Normalise via Buffer.from so the hex-comparison works regardless
		// of whether the driver returns Buffer or Uint8Array.
		const hashes = new Set(refRows.map((r) => Buffer.from(r.hash).toString('hex')));
		expect(hashes.size).toBe(1);

		const finalRow = await knex('page_html_blobs')
			.count<{ count: number }[]>('* as count')
			.first();
		const final = Number(finalRow?.count ?? 0);
		expect(final - baseline).toBe(1);

		expect(await archive.getHtmlOfPage(aId)).toBe(sharedBody);
		expect(await archive.getHtmlOfPage(bId)).toBe(sharedBody);
	});
});

/**
 * `close()` must bound its `db.destroy()` wait so a viewer Ctrl-C while a
 * live crawler holds the SQLite write lock can't hang for the underlying
 * pool's `acquireTimeoutMillis` (10 minutes in this repo).
 */
describe('ArchiveAccessor.close timeout safety', () => {
	it('db.destroy がハングしても close は timeoutMs 内に resolve する', async () => {
		// Fake Database whose destroy() never resolves — mimics a knex
		// pool deadlocked on a long-held write lock.
		const fakeDb = {
			on: () => {},
			destroy: () =>
				new Promise<void>(() => {
					/* never resolves */
				}),
		} as unknown as Database;
		const accessor = new ArchiveAccessor('/tmp/never', fakeDb);
		const start = Date.now();
		await accessor.close({ timeoutMs: 100 });
		const elapsed = Date.now() - start;
		// Generous upper bound to avoid CI flakes; the wait itself is 100ms
		// so anything close to that (e.g. <500ms) proves the race escaped.
		expect(elapsed).toBeLessThan(500);
	});

	it('同じ accessor への concurrent close は同じ promise を共有する（idempotent + race-free）', async () => {
		let destroyCalls = 0;
		const fakeDb = {
			on: () => {},
			destroy: async () => {
				destroyCalls++;
				await new Promise((r) => setTimeout(r, 20));
			},
		} as unknown as Database;
		const accessor = new ArchiveAccessor('/tmp/concurrent', fakeDb);

		// Fire two concurrent closes — they must await the same promise.
		await Promise.all([accessor.close(), accessor.close()]);

		expect(destroyCalls).toBe(1);
	});

	it('db.destroy が reject すると close も reject する（が再試行できないので二度目以降は同じ rejection を返す）', async () => {
		const fakeDb = {
			on: () => {},
			destroy: () => Promise.reject(new Error('boom')),
		} as unknown as Database;
		const accessor = new ArchiveAccessor('/tmp/reject', fakeDb);
		await expect(accessor.close()).rejects.toThrow('boom');
		// Latched: a follow-up close awaits the same rejected promise.
		await expect(accessor.close()).rejects.toThrow('boom');
	});
});
