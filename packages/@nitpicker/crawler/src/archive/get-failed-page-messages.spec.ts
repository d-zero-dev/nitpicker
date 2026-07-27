import fs from 'node:fs/promises';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { Database } from './database.js';
import { getFailedPageMessages } from './get-failed-page-messages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(
	__dirname,
	'__mock__',
	'get-failed-page-messages-test.sqlite',
);

/**
 * Insert a minimal `pages` row and return its id.
 * @param db - The connected database.
 * @param url - The page URL to insert.
 * @returns The inserted row id.
 */
async function insertPageRow(db: Database, url: string): Promise<number> {
	const knex = db.getKnex();
	const [urlRef] = await knex('url_refs').insert({ url }).returning('id');
	const [ctRef] = await knex('content_type_refs')
		.insert({ raw: 'text/html', normalized: 'text/html', category: 'other' })
		.onConflict('raw')
		.merge({ raw: 'text/html' })
		.returning('id');
	const [inserted] = await knex('content_items')
		.insert({
			url_id: urlRef.id,
			scraped: 1,
			is_target: 1,
			is_external: 0,
			status: -1,
			status_text: 'NetTimeoutError',
			content_type_id: ctRef.id,
			content_length: 0,
			is_skipped: 0,
		})
		.returning('id');
	return Number(
		typeof inserted === 'object' ? (inserted as { id: number }).id : inserted,
	);
}

afterAll(async () => {
	await fs.rm(dbPath, { force: true });
});

describe('getFailedPageMessages', () => {
	it('returns an empty map for an empty id list (no SQL fired)', async () => {
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const result = await getFailedPageMessages(db.getKnex(), [], []);
		expect(result.size).toBe(0);
		await db.destroy();
	});

	it('throws when ids and urls have different lengths — the 1:1 join requires it', async () => {
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		await expect(
			getFailedPageMessages(db.getKnex(), [1, 2], ['https://example.com/a']),
		).rejects.toThrow(/1:1/);
		await db.destroy();
	});

	it('prefers page_errors when both page_errors and crawl_errors carry messages', async () => {
		// The two sources can disagree (different layers see different
		// symptoms); `page_errors` wins because it was recorded by the actual
		// scrape attempt, closer to the failure surface.
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const url = 'https://example.com/double-source';
		const pageId = await insertPageRow(db, url);
		await knex('page_errors').insert({
			pageId,
			phase: 'render',
			message: 'from-page-errors',
			createdAt: 1_700_000_000_000,
		});
		await knex('crawl_errors').insert({
			url,
			isExternal: 0,
			message: 'from-crawl-errors',
			createdAt: 1_700_000_000_000,
		});

		const result = await getFailedPageMessages(knex, [pageId], [url]);
		expect(result.get(pageId)?.message).toBe('from-page-errors');

		await db.destroy();
	});

	it('returns the page_errors createdAt alongside the message', async () => {
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const url = 'https://example.com/with-timestamp';
		const pageId = await insertPageRow(db, url);
		await knex('page_errors').insert({
			pageId,
			phase: 'render',
			message: 'timed-error',
			createdAt: 1_700_000_123_456,
		});

		const result = await getFailedPageMessages(knex, [pageId], [url]);
		expect(result.get(pageId)).toEqual({
			message: 'timed-error',
			createdAt: 1_700_000_123_456,
		});

		await db.destroy();
	});

	it('falls back to crawl_errors when page_errors has no row for the id', async () => {
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const url = 'https://example.com/crawl-only';
		const pageId = await insertPageRow(db, url);
		await knex('crawl_errors').insert({
			url,
			isExternal: 0,
			message: 'crawl-only-msg',
			createdAt: 1_700_000_000_000,
		});

		const result = await getFailedPageMessages(knex, [pageId], [url]);
		expect(result.get(pageId)?.message).toBe('crawl-only-msg');
		expect(result.get(pageId)?.createdAt).toBe(1_700_000_000_000);

		await db.destroy();
	});

	it('prefers the LATEST crawl_errors row when multiple rows share the same URL', async () => {
		// Previously undefined behaviour (no ORDER BY — SQLite's natural
		// scan order decided the winner). Fixed to explicitly pick the most
		// recent row: the freshest evidence is what both classification and
		// outage-window attribution should key off, not insertion order.
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const url = 'https://example.com/multi-crawl-error';
		const pageId = await insertPageRow(db, url);
		await knex('crawl_errors').insert([
			{
				url,
				isExternal: 0,
				message: 'stale-error',
				createdAt: 1_700_000_000_000,
			},
			{
				url,
				isExternal: 0,
				message: 'fresh-error',
				createdAt: 1_700_000_050_000,
			},
		]);

		const result = await getFailedPageMessages(knex, [pageId], [url]);
		expect(result.get(pageId)).toEqual({
			message: 'fresh-error',
			createdAt: 1_700_000_050_000,
		});

		await db.destroy();
	});

	it('takes the earliest page_errors row when multiple exist per pageId', async () => {
		// Schema permits multiple `page_errors` rows per page (the same scrape
		// can record several phase errors in sequence). The earliest insert is
		// usually the trigger cause; later rows are follow-on noise. The helper
		// pins this invariant so retry-exclusion classifies on the trigger,
		// not the noisier downstream wrapper.
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const url = 'https://example.com/multi-error';
		const pageId = await insertPageRow(db, url);
		await knex('page_errors').insert([
			{
				pageId,
				phase: 'crawl',
				message: 'first-error',
				createdAt: 1_700_000_000_000,
			},
			{
				pageId,
				phase: 'render',
				message: 'second-error',
				createdAt: 1_700_000_000_001,
			},
		]);

		const result = await getFailedPageMessages(knex, [pageId], [url]);
		expect(result.get(pageId)?.message).toBe('first-error');

		await db.destroy();
	});

	it('treats an empty-string page_errors message as "no signal" and falls through to crawl_errors', async () => {
		// A `page_errors` row with `message=''` is recorded when a scraper
		// phase fires its trigger but has no descriptive text. The empty
		// message carries zero classification value — without this
		// fallthrough, `--retry-failed`'s permanent-kind filter would see
		// `''` (classifies as `unknown`) and keep retrying the page on
		// every iteration, even though the crawl_errors row holds a
		// `dns` / `tls` / `client-blocked` message that would correctly
		// classify the failure as permanent.
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const url = 'https://example.com/empty-page-error';
		const pageId = await insertPageRow(db, url);
		await knex('page_errors').insert({
			pageId,
			phase: 'crawl',
			message: '',
			createdAt: 1_700_000_000_000,
		});
		await knex('crawl_errors').insert({
			url,
			isExternal: 0,
			message: 'getaddrinfo ENOTFOUND empty-page-error.example.com',
			createdAt: 1_700_000_000_000,
		});

		const result = await getFailedPageMessages(knex, [pageId], [url]);
		expect(result.get(pageId)?.message).toBe(
			'getaddrinfo ENOTFOUND empty-page-error.example.com',
		);

		await db.destroy();
	});

	it('ignores crawl_errors rows whose url is NULL (process-level errors)', async () => {
		// `crawl_errors.url` is schema-nullable for process-level errors
		// that have no associated URL. The helper has a defensive guard
		// (`row.url !== null`) but no test had pinned it — a future
		// refactor narrowing the type to `string` could remove the guard
		// and a null url would silently be coerced into a Map key.
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const trackedUrl = 'https://example.com/tracked';
		const trackedId = await insertPageRow(db, trackedUrl);
		await knex('crawl_errors').insert([
			{
				url: null,
				isExternal: 0,
				message: 'process-level boom',
				createdAt: 1_700_000_000_000,
			},
			{
				url: trackedUrl,
				isExternal: 0,
				message: 'real per-url msg',
				createdAt: 1_700_000_000_000,
			},
		]);

		const result = await getFailedPageMessages(knex, [trackedId], [trackedUrl]);
		expect(result.get(trackedId)?.message).toBe('real per-url msg');

		await db.destroy();
	});

	it('omits ids with no recorded message from the returned map', async () => {
		await fs.rm(dbPath, { force: true });
		const db = await Database.connect({ filename: dbPath });
		const knex = db.getKnex();

		const orphanUrl = 'https://example.com/no-message';
		const orphanId = await insertPageRow(db, orphanUrl);
		const trackedUrl = 'https://example.com/tracked';
		const trackedId = await insertPageRow(db, trackedUrl);
		await knex('page_errors').insert({
			pageId: trackedId,
			phase: 'crawl',
			message: 'tracked-msg',
			createdAt: 1_700_000_000_000,
		});

		const result = await getFailedPageMessages(
			knex,
			[orphanId, trackedId],
			[orphanUrl, trackedUrl],
		);
		expect(result.has(orphanId)).toBe(false);
		expect(result.get(trackedId)?.message).toBe('tracked-msg');

		await db.destroy();
	});
});
