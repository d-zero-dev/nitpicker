import { zstdDecompressSync } from 'node:zlib';

import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createPhase6ARefTables } from '../create-phase6a-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { populateBlobRefs } from './populate-blob-refs.js';

/**
 * Minimal in-memory archive with just the `images` table and Phase 6-A
 * ref tables. `populateBlobRefs` only touches `images.src` /
 * `images.currentSrc`.
 * @returns The connected Knex instance; the caller destroys it.
 */
async function setup(): Promise<ReturnType<typeof knex>> {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
	await db.schema.createTable('images', (t) => {
		t.increments('id');
		t.integer('pageId').notNullable();
		t.text('src').nullable();
		t.text('currentSrc').nullable();
	});
	await createPhase6ARefTables(db);
	return db;
}

/**
 * Builds a data URI whose overall length exceeds the 512-byte threshold
 * used by `populateBlobRefs`. Padding with base64-friendly `A` chars keeps
 * the payload bytes deterministic across invocations.
 * @param sizeBytes - Desired approximate total length of the data URI.
 * @returns A `data:image/png;base64,` URI padded to about `sizeBytes`.
 */
function bigPngUri(sizeBytes: number): string {
	const prefix = 'data:image/png;base64,';
	return prefix + 'A'.repeat(Math.max(sizeBytes - prefix.length, 1));
}

describe('populateBlobRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setup();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('stores decoded, compressed data-URI payloads > 512 bytes', async () => {
		const uri = bigPngUri(1024);
		await db('images').insert([{ pageId: 1, src: uri, currentSrc: null }]);
		await populateBlobRefs(db);
		const rows = await db('blob_refs').select();
		expect(rows).toHaveLength(1);
		expect(rows[0]!.codec).toBe('zstd');
		expect(rows[0]!.size_raw).toBeGreaterThan(0);
		expect(rows[0]!.size_stored).toBeGreaterThan(0);
		const decompressed = zstdDecompressSync(Buffer.from(rows[0]!.body));
		expect(decompressed.length).toBe(rows[0]!.size_raw);
	});

	it('skips data URIs at or below 512 bytes', async () => {
		const smallUri = 'data:image/svg+xml;base64,PHN2Zy8+'; // ~30 chars
		await db('images').insert([{ pageId: 1, src: smallUri, currentSrc: null }]);
		await populateBlobRefs(db);
		expect(await db('blob_refs').select()).toHaveLength(0);
	});

	it('skips non-data URIs', async () => {
		await db('images').insert([
			{ pageId: 1, src: 'https://example.com/img.png', currentSrc: null },
		]);
		await populateBlobRefs(db);
		expect(await db('blob_refs').select()).toHaveLength(0);
	});

	it('deduplicates identical payloads across src and currentSrc', async () => {
		const uri = bigPngUri(1200);
		await db('images').insert([
			{ pageId: 1, src: uri, currentSrc: uri },
			{ pageId: 2, src: uri, currentSrc: null },
		]);
		await populateBlobRefs(db);
		expect(await db('blob_refs').select()).toHaveLength(1);
	});

	it('is idempotent', async () => {
		const uri = bigPngUri(1024);
		await db('images').insert([{ pageId: 1, src: uri, currentSrc: null }]);
		await populateBlobRefs(db);
		await populateBlobRefs(db);
		const count = await db('blob_refs').count<{ n: number }[]>('id as n');
		expect(Number(count[0]!.n)).toBe(1);
	});
});
