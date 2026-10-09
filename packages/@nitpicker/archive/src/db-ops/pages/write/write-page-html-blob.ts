import type { Knex } from 'knex';

import { createHash } from 'node:crypto';

import { compressPayload } from '../../_shared/compress-payload.js';

/**
 * Encodes, dedups, and persists a page's HTML snapshot.
 *
 * Computes SHA-256 over the raw UTF-8 bytes, compresses them with zstd,
 * inserts into `page_html_blobs` only if the hash is new (so identical
 * bodies — 404 templates, error pages, redirect destinations — share a
 * single row), and then upserts `page_html_ref(page_id → hash)` so the
 * latest scrape always points at the right body.
 *
 * Runs entirely inside the caller's transaction; a failure here rolls
 * back the rest of `updatePage`, which is the desired semantics (an
 * archive that lost its HTML for a page would otherwise serve stale
 * meta against a missing body).
 * @param pageId - The database id of the page.
 * @param html - The raw HTML string (UTF-8).
 * @param trx - The active transaction.
 */
export async function writePageHtmlBlob(
	pageId: number,
	html: string,
	trx: Knex.Transaction,
): Promise<void> {
	const rawBytes = Buffer.from(html, 'utf8');
	const hash = createHash('sha256').update(rawBytes).digest();
	const { body, codec, sizeRaw, sizeStored } = compressPayload(rawBytes);
	await trx('page_html_blobs')
		.insert({
			hash,
			body,
			codec,
			size_raw: sizeRaw,
			size_stored: sizeStored,
		})
		.onConflict('hash')
		.ignore();
	// Upsert so a re-scrape's body cleanly supersedes the prior pointer.
	// The old blob row is intentionally left in place — a future #23 GC
	// pass will sweep unreachable hashes.
	await trx('page_html_ref')
		.insert({ page_id: pageId, hash })
		.onConflict('page_id')
		.merge(['hash']);
}
