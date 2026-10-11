import { decodeStoredBlob } from '@nitpicker/archive/decode-html-blob';
import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LibsqlDialect } from '../../packages/@nitpicker/archive/lib/libsql-dialect.js';

import { iterateHtmlBlobs } from './iterate-html-blobs.mjs';

/**
 * @param {import('knex').Knex} db - The connection.
 * @param {number[]} hashBytes - One first hash byte per blob (BLOB keys sort bytewise).
 * @param {{ referenced?: boolean }} [options] - Whether a page references the blobs (default true).
 */
async function insertBlobs(db, hashBytes, options = {}) {
	for (const byte of hashBytes) {
		const hash = Buffer.from([byte, 0xff]);
		const body = Buffer.from(`<p>${byte}</p>`);
		await db('page_html_blobs').insert({
			hash,
			body,
			codec: 'none',
			size_raw: body.length,
			size_stored: body.length,
		});
		if (options.referenced ?? true) {
			await db('page_html_ref').insert({ page_id: byte, hash });
		}
	}
}

/**
 * @param {AsyncIterable<{ body: Uint8Array; codec: string }>} blobs - The iterator under test.
 * @returns {Promise<string[]>} Each blob decoded the way the benches decode it, in yield order.
 */
async function collectDocuments(blobs) {
	const documents = [];
	for await (const blob of blobs) {
		documents.push(decodeStoredBlob(blob.body, blob.codec));
	}
	return documents;
}

describe('iterateHtmlBlobs', () => {
	let db;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		// The archive's own DDL for the two tables (create-adjunct-tables.ts).
		await db.raw(`
			CREATE TABLE page_html_blobs (
				hash         BLOB PRIMARY KEY,
				body         BLOB NOT NULL,
				codec        TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
				size_raw     INTEGER NOT NULL,
				size_stored  INTEGER NOT NULL
			) WITHOUT ROWID
		`);
		await db.raw(
			'CREATE TABLE page_html_ref (page_id INTEGER PRIMARY KEY, hash BLOB NOT NULL)',
		);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('yields nothing for an archive without snapshots', async () => {
		expect(await collectDocuments(iterateHtmlBlobs(db, { chunkSize: 2 }))).toEqual([]);
	});

	it('yields every referenced blob once, decodable, in hash order, across several chunks', async () => {
		await insertBlobs(db, [5, 1, 4, 2, 3]);
		expect(await collectDocuments(iterateHtmlBlobs(db, { chunkSize: 2 }))).toEqual([
			'<p>1</p>',
			'<p>2</p>',
			'<p>3</p>',
			'<p>4</p>',
			'<p>5</p>',
		]);
	});

	it('does not repeat or drop a blob when the count is a multiple of the chunk size', async () => {
		await insertBlobs(db, [4, 3, 2, 1]);
		expect(await collectDocuments(iterateHtmlBlobs(db, { chunkSize: 2 }))).toEqual([
			'<p>1</p>',
			'<p>2</p>',
			'<p>3</p>',
			'<p>4</p>',
		]);
	});

	it('skips blobs no page references', async () => {
		await insertBlobs(db, [1, 3]);
		await insertBlobs(db, [2, 4], { referenced: false });
		expect(await collectDocuments(iterateHtmlBlobs(db, { chunkSize: 1 }))).toEqual([
			'<p>1</p>',
			'<p>3</p>',
		]);
	});
});
