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
	const [inserted] = await knex('pages')
		.insert({
			url,
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			status: -1,
			statusText: 'NetTimeoutError',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: '{}',
			isSkipped: 0,
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
		expect(result.get(pageId)).toBe('from-page-errors');

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
		expect(result.get(pageId)).toBe('crawl-only-msg');

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
		expect(result.get(pageId)).toBe('first-error');

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
		expect(result.get(trackedId)).toBe('tracked-msg');

		await db.destroy();
	});
});
