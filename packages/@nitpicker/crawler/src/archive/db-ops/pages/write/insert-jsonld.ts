import type { PageData } from '../../../../utils/types/types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { classifyJsonLdType } from '../../../meta/classify-jsonld-type.js';

/**
 * Replaces the page's JSON-LD / SpeculationRules rows with the freshly
 * captured set. Called inside `updatePage`'s transaction.
 *
 * `writeHtml = false` branches (`setExternalPage`, metadata-only) skip
 * this entirely — JSON-LD lives inside the HTML body, so external pages
 * that are not rendered have no entries to write. An empty array on a
 * normally-rendered page is treated as a degraded re-scrape: prior rows
 * are kept (same `delete-only-when-replacing` invariant as `anchors` /
 * `images`).
 * @param pageId
 * @param meta
 * @param trx
 */
export async function insertJsonLd(
	pageId: number,
	meta: PageData['meta'],
	trx: Knex.Transaction,
): Promise<void> {
	// `??` guards tolerate the legacy "minimal meta" shape from older test
	// fixtures. Real beholder 3.0.0 always populates these required fields.
	const jsonLd = meta.jsonLd ?? [];
	const speculationRules = meta.speculationRules ?? [];
	const rows: Array<{
		pageId: number;
		kind: 'ld+json' | 'speculationrules';
		type: string | null;
		raw: string;
		parsed: string | null;
		parseError: string | null;
	}> = [];
	for (const entry of jsonLd) {
		rows.push({
			pageId,
			kind: 'ld+json',
			type: classifyJsonLdType(entry),
			raw: entry.raw,
			parsed: entry.parsed === undefined ? null : JSON.stringify(entry.parsed),
			parseError: entry.parseError ?? null,
		});
	}
	for (const entry of speculationRules) {
		rows.push({
			pageId,
			kind: 'speculationrules',
			type: classifyJsonLdType(entry),
			raw: entry.raw,
			parsed: entry.parsed === undefined ? null : JSON.stringify(entry.parsed),
			parseError: entry.parseError ?? null,
		});
	}
	if (rows.length === 0) return;
	await trx('page_jsonld').where('pageId', pageId).delete();
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('page_jsonld').insert(chunk);
	});
}
