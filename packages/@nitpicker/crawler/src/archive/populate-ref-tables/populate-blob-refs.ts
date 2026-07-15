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
 * Populates `blob_refs` from every `images.src` / `images.currentSrc`
 * value that is a data URI longer than {@link DATA_URI_URL_REFS_LIMIT}
 * bytes (issue #191).
 *
 * For each such value:
 *
 * 1. `decodeDataUri` strips the `data:...;base64,` (or `data:...,`) prefix
 *    and returns the raw payload bytes.
 * 2. `computeContentHash` hashes the payload bytes (32-byte SHA-256).
 * 3. The payload is zstd-compressed (`codec='zstd'`) — matching
 *    `page_html_blobs` / `json_refs`.
 * 4. `INSERT OR IGNORE` on `hash` deduplicates: two `<img>` elements with
 *    the same underlying base64 payload share one `blob_refs` row.
 *
 * Malformed data URIs that `decodeDataUri` cannot decode are logged and
 * skipped — the raw URI string still exists in the source `images.src`
 * row, and the migration script's operator can hunt it down from the
 * warning log. The alternative — routing malformed large URIs back to
 * `url_refs` — would break the "data URIs > threshold live in
 * blob_refs" contract that 0.13 lookups depend on.
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
	const hasImages = await trx.schema.hasTable('images');
	if (!hasImages) {
		return;
	}
	const hasSrc = await trx.schema.hasColumn('images', 'src');
	const hasCurrentSrc = await trx.schema.hasColumn('images', 'currentSrc');
	const columns = [
		'id',
		...(hasSrc ? ['src'] : []),
		...(hasCurrentSrc ? ['currentSrc'] : []),
	];
	if (columns.length === 1) {
		// Only `id` — neither URL column present, nothing to scan.
		return;
	}

	const seen = new Set<string>();
	const pending: {
		hash: Buffer;
		body: Buffer;
		codec: 'zstd';
		size_raw: number;
		size_stored: number;
	}[] = [];

	let cursor = 0;
	while (true) {
		const rows: Record<string, unknown>[] = await trx('images')
			.select(...columns)
			.where('id', '>', cursor)
			.orderBy('id', 'asc')
			.limit(READ_CHUNK_SIZE);
		if (rows.length === 0) {
			break;
		}
		cursor = rows.at(-1)!.id as number;
		for (const row of rows) {
			const values: (string | null)[] = [];
			if (hasSrc) {
				values.push(row.src as string | null);
			}
			if (hasCurrentSrc) {
				values.push(row.currentSrc as string | null);
			}
			for (const value of values) {
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
						`populateBlobRefs: skipping malformed data URI (length=${value.length}) — raw string still exists in images row`,
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

	if (pending.length > 0) {
		await trx('blob_refs').insert(pending).onConflict('hash').ignore();
	}
}
