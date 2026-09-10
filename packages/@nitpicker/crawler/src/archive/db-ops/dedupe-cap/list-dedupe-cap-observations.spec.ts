import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';
import { upsertTextRefs } from '../../populate-entity-tables/upsert-text-refs.js';

import { listDedupeCapObservations } from './list-dedupe-cap-observations.js';

/**
 * Inserts one candidate `content_items` row (with an optional `page_meta`
 * row) with every column `listDedupeCapObservations`'s WHERE clause reads,
 * so each test can assert the exclusion logic against a precise state.
 * @param db - Knex connected to the in-memory test DB.
 * @param row - The page fields to insert. Defaults model a fully-qualifying
 *   internal, scraped, non-redirect, non-skipped page with a body hash.
 * @param row.url
 * @param row.scraped
 * @param row.isExternal
 * @param row.isTarget
 * @param row.isSkipped
 * @param row.redirectDestId
 * @param row.withPageMeta
 * @param row.bodyHash
 * @param row.title
 * @param row.description
 * @param row.ogTitle
 * @param row.ogUrl
 * @returns The inserted `content_items.id`.
 */
async function seedCandidate(
	db: Knex,
	row: {
		url: string;
		scraped?: number;
		isExternal?: number;
		isTarget?: number;
		isSkipped?: number | null;
		redirectDestId?: number | null;
		withPageMeta?: boolean;
		bodyHash?: Buffer | null;
		title?: string;
		description?: string | null;
		ogTitle?: string | null;
		ogUrl?: string | null;
	},
): Promise<number> {
	const [urlRef] = await db('url_refs').insert({ url: row.url }).returning('id');
	const [inserted] = await db('content_items')
		.insert({
			url_id: urlRef.id,
			scraped: row.scraped ?? 1,
			is_external: row.isExternal ?? 0,
			is_target: row.isTarget ?? 1,
			is_skipped: row.isSkipped ?? 0,
			redirect_dest_id: row.redirectDestId ?? null,
		})
		.returning('id');
	const pageId = Number(
		typeof inserted === 'object' ? (inserted as { id: number }).id : inserted,
	);

	if (row.withPageMeta ?? true) {
		const textIdMap = await upsertTextRefs(
			db,
			[row.title, row.description, row.ogTitle].filter(
				(text): text is string => typeof text === 'string' && text !== '',
			),
		);
		let ogUrlId: number | null = null;
		if (row.ogUrl) {
			const [ogUrlRef] = await db('url_refs')
				.insert({ url: row.ogUrl })
				.onConflict('url')
				.merge({ url: row.ogUrl })
				.returning('id');
			ogUrlId = ogUrlRef.id;
		}
		await db('page_meta').insert({
			page_id: pageId,
			title_text_id: row.title ? (textIdMap.get(row.title) ?? null) : null,
			description_text_id: row.description
				? (textIdMap.get(row.description) ?? null)
				: null,
			og_title_text_id: row.ogTitle ? (textIdMap.get(row.ogTitle) ?? null) : null,
			og_url_id: ogUrlId,
			body_hash: row.bodyHash === undefined ? Buffer.from('body-hash') : row.bodyHash,
		});
	}

	return pageId;
}

describe('listDedupeCapObservations', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('空のアーカイブでは空配列を返す', async () => {
		expect(await listDedupeCapObservations(db)).toEqual([]);
	});

	it('条件を満たすページの全フィールドを返す', async () => {
		await seedCandidate(db, {
			url: 'https://example.com/news/date/2024/',
			title: 'お知らせ',
			description: '一覧です',
			ogTitle: 'OG Title',
			ogUrl: 'https://example.com/news/date/2024/',
			bodyHash: Buffer.from('body-hash-1'),
		});

		const rows = await listDedupeCapObservations(db);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({
			url: 'https://example.com/news/date/2024/',
			title: 'お知らせ',
			description: '一覧です',
			ogTitle: 'OG Title',
			ogUrl: 'https://example.com/news/date/2024/',
			bodyHash: Buffer.from('body-hash-1'),
		});
	});

	it('title/description/og:* が未設定なら null で返す', async () => {
		await seedCandidate(db, { url: 'https://example.com/no-meta/' });
		const rows = await listDedupeCapObservations(db);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			title: null,
			description: null,
			ogTitle: null,
			ogUrl: null,
		});
	});

	it('外部ページ（is_external=1）は除外する', async () => {
		await seedCandidate(db, { url: 'https://external.example/', isExternal: 1 });
		expect(await listDedupeCapObservations(db)).toEqual([]);
	});

	it('metadata-only ページ（is_target=0）は除外する', async () => {
		await seedCandidate(db, { url: 'https://example.com/meta-only/', isTarget: 0 });
		expect(await listDedupeCapObservations(db)).toEqual([]);
	});

	it('redirect元（redirect_dest_id が非NULL）は除外する', async () => {
		const destId = await seedCandidate(db, { url: 'https://example.com/dest/' });
		await seedCandidate(db, {
			url: 'https://example.com/src/',
			redirectDestId: destId,
		});
		const rows = await listDedupeCapObservations(db);
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/dest/']);
	});

	it('skip済み（is_skipped=1）は除外する', async () => {
		await seedCandidate(db, { url: 'https://example.com/skipped/', isSkipped: 1 });
		expect(await listDedupeCapObservations(db)).toEqual([]);
	});

	it('body_hash が NULL（旧アーカイブ未backfill）は除外する', async () => {
		await seedCandidate(db, { url: 'https://example.com/no-body-hash/', bodyHash: null });
		expect(await listDedupeCapObservations(db)).toEqual([]);
	});

	it('scraped=0（未取得）は除外する', async () => {
		await seedCandidate(db, { url: 'https://example.com/pending/', scraped: 0 });
		expect(await listDedupeCapObservations(db)).toEqual([]);
	});

	it('page_meta 行自体が無いページは除外する', async () => {
		await seedCandidate(db, {
			url: 'https://example.com/no-page-meta/',
			withPageMeta: false,
		});
		expect(await listDedupeCapObservations(db)).toEqual([]);
	});

	it('content_items.id 順に返し、onProgress を進捗付きで呼ぶ', async () => {
		await seedCandidate(db, { url: 'https://example.com/a/' });
		await seedCandidate(db, { url: 'https://example.com/b/' });
		await seedCandidate(db, { url: 'https://example.com/c/' });

		const progressCalls: [number, number][] = [];
		const rows = await listDedupeCapObservations(db, (scanned, max) => {
			progressCalls.push([scanned, max]);
		});

		expect(rows.map((r) => r.url)).toEqual([
			'https://example.com/a/',
			'https://example.com/b/',
			'https://example.com/c/',
		]);
		expect(progressCalls.length).toBeGreaterThan(0);
		const [lastScanned, lastMax] = progressCalls.at(-1)!;
		expect(lastScanned).toBe(lastMax);
	});
});
