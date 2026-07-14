import type { Knex } from 'knex';

import { classifyContentType } from './classify-content-type.js';

/**
 * Distinct-`contentType` rows are collected from `pages` + `resources` in
 * chunks of this size before being written into `content_type_refs`. The
 * DISTINCT list is expected to be tiny (< 1000 rows even on the largest
 * archives — the wire content-type space is small) so the chunk size only
 * bounds worst-case parameter counts on `INSERT ... VALUES ...`.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * Drops every C0 control character (`0x00`..`0x1F`) and DEL (`0x7F`)
 * from `text`. `jsdom` / lax parsers occasionally emit these inside a
 * raw Content-Type header (e.g. `text/html\r`); leaving them in
 * `content_type_refs.normalized` would fork two rows for the "same"
 * content-type into different normalized values.
 *
 * Implemented character-by-character rather than as a regex literal so
 * the source file carries no non-printing bytes and stays tool-friendly.
 * @param text - Input string.
 * @returns `text` with C0 controls and DEL stripped.
 */
function stripControlChars(text: string): string {
	let output = '';
	for (const ch of text) {
		const code = ch.codePointAt(0)!;
		if (code < 32 /* 0x20 = SPACE */ || code === 127 /* 0x7F = DEL */) {
			continue;
		}
		output += ch;
	}
	return output;
}

/**
 * Normalises a raw Content-Type header value to a canonical MIME
 * (control-char stripped, trimmed, lower-cased, parameters removed).
 * Duplicated once here instead of shared with {@link classifyContentType}
 * — that function must accept the raw value verbatim so it can also
 * handle `null` / `''` cases, whereas the migration insert wants the
 * pre-normalised form to write into `content_type_refs.normalized`.
 * @param raw - Raw Content-Type header, guaranteed non-null non-empty.
 * @returns Lower-cased MIME with parameters and control chars stripped.
 */
function normalizeMime(raw: string): string {
	const semi = raw.indexOf(';');
	const head = semi === -1 ? raw : raw.slice(0, semi);
	return stripControlChars(head).trim().toLowerCase();
}

/**
 * Populates `content_type_refs` from every distinct `contentType` value
 * currently stored in `pages` and `resources` (issue #191 step ref populate step 0).
 *
 * Two independent DISTINCT SELECTs (one per table) are merged in JS
 * rather than via SQL `UNION` — the cardinality is small in practice and
 * doing it in JS avoids the knex-`union().select()` column-aliasing
 * quirk (bare `.select()` on a union wraps in `SELECT *` and can lose
 * the column name depending on driver version). Two per-table SELECTs
 * are also fast because `contentType` is indexed on both tables via
 * `idx_pages_listfilter` / natural column index (see `init-schema.ts`).
 *
 * `normalized` and `category` are derived in JS via {@link classifyContentType}
 * so the rule table stays in one place; SQLite has no equivalent
 * expression.
 *
 * `INSERT OR IGNORE` on the natural key `raw` makes this idempotent —
 * re-running the populate step after a partial failure never duplicates
 * rows, only appends the new ones.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateContentTypeRefs(trx);
 * });
 */
export async function populateContentTypeRefs(trx: Knex): Promise<void> {
	const distinctRaw = new Set<string>();
	if (await trx.schema.hasTable('pages')) {
		const pagesRows: { contentType: string | null }[] = await trx('pages')
			.distinct('contentType')
			.whereNotNull('contentType');
		for (const { contentType } of pagesRows) {
			if (contentType != null && contentType !== '') {
				distinctRaw.add(contentType);
			}
		}
	}
	if (await trx.schema.hasTable('resources')) {
		const resourcesRows: { contentType: string | null }[] = await trx('resources')
			.distinct('contentType')
			.whereNotNull('contentType');
		for (const { contentType } of resourcesRows) {
			if (contentType != null && contentType !== '') {
				distinctRaw.add(contentType);
			}
		}
	}
	if (distinctRaw.size === 0) {
		return;
	}

	const inserts = [...distinctRaw].map((raw) => ({
		raw,
		normalized: normalizeMime(raw),
		category: classifyContentType(raw),
	}));

	for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
		const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
		await trx('content_type_refs').insert(chunk).onConflict('raw').ignore();
	}
}
