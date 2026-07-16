import type { WriteRefCaches } from './types.js';
import type { Knex } from 'knex';

import { classifyContentType } from '../../populate-ref-tables/classify-content-type.js';

/**
 * Resolves the `content_type_refs.id` for one content-type value,
 * inserting the dictionary row when the value is new.
 *
 * `raw` is expected to be the already-canonicalised form produced by
 * `normalizeContentType` (lower-cased, trimmed) — the write path
 * canonicalises before storing, exactly as the legacy `pages.contentType`
 * column did, so the dictionary's natural key never forks on case or
 * whitespace variants of the same MIME. `normalized` strips any `;`
 * parameter tail and control characters on top of that; `category` is
 * derived via {@link ../../populate-ref-tables/classify-content-type.ts}.
 *
 * The content-type space is tiny (well under 1 000 distinct values on
 * even the largest archives) so the cache converges after the first few
 * pages and steady-state calls issue no SQL.
 * @param qb - Knex instance or transaction connected to the archive DB.
 * @param caches - The connection's write-side id caches; mutated in place.
 * @param raw - Canonicalised content-type value. Pass the output of
 *   `normalizeContentType`; `null` / empty input must be short-circuited
 *   by the caller (a row without a content type stores `content_type_id
 *   = null`, not a dictionary entry).
 * @returns The `content_type_refs.id` of the existing or new row.
 * @example
 * const id = await upsertContentTypeRef(knex, caches, 'text/html');
 */
export async function upsertContentTypeRef(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	raw: string,
): Promise<number> {
	const cached = caches.contentTypeIds.get(raw);
	if (cached !== undefined) {
		return cached;
	}
	const rows: { id: number }[] = await qb.raw(
		`INSERT INTO content_type_refs (raw, normalized, category)
		 VALUES (?, ?, ?)
		 ON CONFLICT(raw) DO UPDATE SET raw = raw
		 RETURNING id`,
		[raw, normalizeMime(raw), classifyContentType(raw)],
	);
	const first = rows[0];
	if (first === undefined) {
		throw new Error(`upsertContentTypeRef: RETURNING yielded no row for ${raw}`);
	}
	caches.contentTypeIds.set(raw, first.id);
	return first.id;
}

/**
 * Normalises a raw Content-Type value to a canonical MIME for the
 * `content_type_refs.normalized` column: parameters (`; charset=...`)
 * removed, C0 control characters and DEL stripped, trimmed, lower-cased.
 * Mirrors the derivation used when the dictionary is populated from an
 * existing archive (`populate-ref-tables/populate-content-type-refs.ts`)
 * so live-crawl rows and migrated rows never fork on the same raw value.
 * @param raw - Raw content-type, guaranteed non-null non-empty.
 * @returns Canonical MIME string.
 */
function normalizeMime(raw: string): string {
	const semi = raw.indexOf(';');
	const head = semi === -1 ? raw : raw.slice(0, semi);
	let output = '';
	for (const ch of head) {
		const code = ch.codePointAt(0)!;
		if (code < 32 /* 0x20 = SPACE */ || code === 127 /* 0x7F = DEL */) {
			continue;
		}
		output += ch;
	}
	return output.trim().toLowerCase();
}
