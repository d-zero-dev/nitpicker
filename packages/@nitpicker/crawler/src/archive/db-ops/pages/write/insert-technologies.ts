import type { PageData } from '../../../../utils/types/types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { extractTechnologiesForArchive } from '../../../meta/technologies/extract-technologies-for-archive.js';

/**
 * Replaces the page's `technology_signals` + `page_technologies` rows with
 * the freshly extracted set. Called inside `updatePage`'s transaction
 * unconditionally — the `wappalyzer` signal source draws on `<script src>` /
 * `<iframe src>` / window globals / response headers, not the HTML body, so
 * external pages that skip rendering still contribute technology signals
 * (structural signals naturally find nothing against an empty `html`
 * string, which is exactly what a skipped render leaves it as).
 *
 * Direct replacement for `insertTags` in the live crawl write path (that
 * file is untouched — `scripts/migrate-to-0.10.mjs` still depends on it).
 *
 * Same empty-guard as `insertTags` / `insertJsonLd`: an empty array does
 * not wipe prior rows on a degraded re-scrape. Both tables are always
 * written together in this one call — see ARCHITECTURE.md's invariant
 * that `technology_signals` and `page_technologies` are never updated
 * independently.
 * @param pageId
 * @param html - The page's raw HTML string (empty for external/metadata-only scrapes).
 * @param meta
 * @param trx
 */
export async function insertTechnologies(
	pageId: number,
	html: string,
	meta: PageData['meta'],
	trx: Knex.Transaction,
): Promise<void> {
	const { signals, technologies } = extractTechnologiesForArchive(html, meta);
	if (signals.length === 0) return;

	await trx('technology_signals').where('pageId', pageId).delete();
	await trx('page_technologies').where('pageId', pageId).delete();

	await eachSplitted(signals, 100, async (chunk) => {
		await trx('technology_signals').insert(
			chunk.map((s) => ({
				pageId,
				technology: s.technology,
				signalType: s.signalType,
				evidence: s.evidence,
				weight: s.weight,
			})),
		);
	});
	if (technologies.length > 0) {
		await eachSplitted(technologies, 100, async (chunk) => {
			await trx('page_technologies').insert(chunk.map((t) => ({ pageId, ...t })));
		});
	}
}
