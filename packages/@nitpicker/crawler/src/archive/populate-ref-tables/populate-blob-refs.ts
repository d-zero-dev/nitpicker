import type { Knex } from 'knex';

import { zstdCompressSync } from 'node:zlib';

import { computeContentHash } from './compute-content-hash.js';
import { DATA_URI_URL_REFS_LIMIT } from './data-uri-url-refs-limit.js';
import { decodeDataUri } from './decode-data-uri.js';

/** Rows scanned per `SELECT`. See `populateTextRefs` for chunking rationale. */
const READ_CHUNK_SIZE = 2000;

/**
 * Rows written per `INSERT`. blob_refs rows carry a compressed body BLOB
 * so 100 rows keeps the total payload of a single INSERT statement well
 * under WAL frame limits even for large SVGs.
 */
const INSERT_CHUNK_SIZE = 100;

/**
 * Source table + its URL-shaped column(s) that may hold a data URI large
 * enough to route to `blob_refs`. `resources.url` is the resource's own
 * identity (unlike `pages`/`content_items`, whose own URL is always a
 * real http(s) address in practice) — a `<link>`/CSS sub-resource can
 * legally be captured as an inline `data:` URI.
 */
const URL_SOURCES: readonly {
	table: 'images' | 'resources';
	columns: readonly string[];
}[] = [
	{ table: 'images', columns: ['src', 'currentSrc'] },
	{ table: 'resources', columns: ['url'] },
];

/**
 * Populates `blob_refs` from every `images.src` / `images.currentSrc` /
 * `resources.url` value that is a data URI longer than
 * {@link DATA_URI_URL_REFS_LIMIT} bytes (issue #191).
 *
 * For each such value:
 *
 * 1. `decodeDataUri` strips the `data:...;base64,` (or `data:...,`) prefix
 *    and returns the raw payload bytes.
 * 2. `computeContentHash` hashes the payload bytes (32-byte SHA-256).
 * 3. The payload is zstd-compressed (`codec='zstd'`) — matching
 *    `page_html_blobs` / `json_refs`.
 * 4. `INSERT OR IGNORE` on `hash` deduplicates: an `<img>` element and a
 *    resource that share the same underlying base64 payload share one
 *    `blob_refs` row.
 *
 * Malformed data URIs that `decodeDataUri` cannot decode are logged and
 * skipped — the raw URI string still exists in the source row, and the
 * migration script's operator can hunt it down from the warning log. The
 * alternative — routing malformed large URIs back to `url_refs` — would
 * break the "data URIs > threshold live in blob_refs" contract that 0.13
 * lookups depend on.
 *
 * On the reference archive only ~429 images use data URIs, so the total
 * dictionary is tiny — this step is I/O-cheap even without full
 * chunking, but the same batching shape is used as elsewhere for
 * consistency.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateBlobRefs(trx);
 * });
 */
export async function populateBlobRefs(trx: Knex): Promise<void> {
	const seen = new Set<string>();
	const pending: {
		hash: Buffer;
		body: Buffer;
		codec: 'zstd';
		size_raw: number;
		size_stored: number;
	}[] = [];

	for (const source of URL_SOURCES) {
		const hasTable = await trx.schema.hasTable(source.table);
		if (!hasTable) {
			continue;
		}
		const presentColumns: string[] = [];
		for (const column of source.columns) {
			if (await trx.schema.hasColumn(source.table, column)) {
				presentColumns.push(column);
			}
		}
		if (presentColumns.length === 0) {
			continue;
		}

		let cursor = 0;
		while (true) {
			const rows: Record<string, unknown>[] = await trx(source.table)
				.select('id', ...presentColumns)
				.where('id', '>', cursor)
				.orderBy('id', 'asc')
				.limit(READ_CHUNK_SIZE);
			if (rows.length === 0) {
				break;
			}
			cursor = rows.at(-1)!.id as number;
			for (const row of rows) {
				for (const column of presentColumns) {
					const value = row[column] as string | null;
					if (value == null || value.length <= DATA_URI_URL_REFS_LIMIT) {
						continue;
					}
					if (!value.startsWith('data:')) {
						continue;
					}
					const decoded = decodeDataUri(value);
					if (decoded === null) {
						// eslint-disable-next-line no-console
						console.warn(
							`populateBlobRefs: skipping malformed data URI (length=${value.length}) — raw string still exists in ${source.table} row`,
						);
						continue;
					}
					const hash = computeContentHash(decoded.bytes);
					const hex = hash.toString('hex');
					if (seen.has(hex)) {
						continue;
					}
					seen.add(hex);
					const compressed = zstdCompressSync(decoded.bytes);
					pending.push({
						hash,
						body: compressed,
						codec: 'zstd',
						size_raw: decoded.bytes.byteLength,
						size_stored: compressed.byteLength,
					});
					if (pending.length >= INSERT_CHUNK_SIZE) {
						await trx('blob_refs').insert(pending).onConflict('hash').ignore();
						pending.length = 0;
					}
				}
			}
		}
	}

	if (pending.length > 0) {
		await trx('blob_refs').insert(pending).onConflict('hash').ignore();
	}
}
