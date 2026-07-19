import type { JsonLdRow } from '../../meta/types.js';
import type { Knex } from 'knex';

import { safeParseJson } from '../_shared/safe-parse-json.js';

/**
 * Retrieves all `page_jsonld` rows for the given page id, parsed back into
 * {@link JsonLdRow} shape (with `parsed` deserialised from its JSON column).
 *
 * Read-side counterpart to `insertJsonLd`. Returns rows in insertion order
 * by `id` so the order observed by `get-page-jsonld` matches the order the
 * scraper saw them.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getJsonLdOfPage(knex: Knex, pageId: number): Promise<JsonLdRow[]> {
	type Row = {
		id: number;
		pageId: number;
		kind: string;
		type: string | null;
		raw: string;
		parsed: string | null;
		parseError: string | null;
	};
	const rows = await knex
		.select<Row[]>('id', 'pageId', 'kind', 'type', 'raw', 'parsed', 'parseError')
		.from('page_jsonld')
		.where('pageId', pageId)
		.orderBy('id', 'asc');
	return rows.map((r) => ({
		id: r.id,
		pageId: r.pageId,
		kind: r.kind === 'speculationrules' ? 'speculationrules' : 'ld+json',
		type: r.type,
		raw: r.raw,
		parsed: r.parsed === null ? null : safeParseJson(r.parsed),
		parseError: r.parseError,
	}));
}
