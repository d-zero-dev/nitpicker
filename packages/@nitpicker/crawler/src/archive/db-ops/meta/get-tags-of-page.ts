import type { TagRow } from '../../meta/types.js';
import type { Knex } from 'knex';

import { safeParseJson } from '../_shared/safe-parse-json.js';

/**
 * Retrieves all `page_tags` rows for the given page id, parsed back into
 * {@link TagRow} shape (with `categories` and `sources` JSON columns
 * deserialised).
 *
 * Read-side counterpart to `insertTags`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getTagsOfPage(knex: Knex, pageId: number): Promise<TagRow[]> {
	type Row = {
		id: number;
		pageId: number;
		provider: string;
		category: string | null;
		externalId: string | null;
		version: string | null;
		confidence: number | null;
		categories: string | null;
		sources: string | null;
	};
	const rows = await knex
		.select<
			Row[]
		>('id', 'pageId', 'provider', 'category', 'externalId', 'version', 'confidence', 'categories', 'sources')
		.from('page_tags')
		.where('pageId', pageId)
		.orderBy('id', 'asc');
	return rows.map((r) => ({
		id: r.id,
		pageId: r.pageId,
		provider: r.provider,
		category: r.category,
		externalId: r.externalId,
		version: r.version,
		confidence: r.confidence,
		categories:
			r.categories === null ? [] : ((safeParseJson(r.categories) as string[]) ?? []),
		sources:
			r.sources === null ? [] : ((safeParseJson(r.sources) as TagRow['sources']) ?? []),
	}));
}
