import type { PageDenormalizedColumns } from './types.js';
import type { Meta } from '@d-zero/beholder';

/**
 * Computes the denormalised aggregate columns stored on the `pages` table at
 * write time: `tag_count`, `jsonld_count`, `tags_providers_csv`.
 *
 * Why denormalise: the Sheets report and the `get-page-detail` summary need
 * "how many JSON-LD entries?" and "which Wappalyzer providers?" for every
 * page row. Computing those at read time forces either a per-page sub-query
 * (N+1) or a site-wide `GROUP BY` (heavy on 1M-page archives). Writing them
 * once at scrape time keeps the read path to a single `pages` projection.
 *
 * `tags_providers_csv` uses comma as separator (no escaping). Wappalyzer
 * provider names do not contain commas in practice; if that ever changes,
 * switch to a JSON array column or use `\x1f` as separator. The CSV form
 * exists because Sheets / Google Spreadsheet renders comma-separated lists
 * natively without unwrapping JSON.
 * @param meta - Beholder-derived metadata for the page.
 * @returns The three denormalised columns.
 */
export function computePageDenormalized(meta: Meta): PageDenormalizedColumns {
	// `??` guards tolerate the legacy "minimal meta" shape (`{ title: 'X' }`)
	// produced by older test fixtures. Real beholder 3.0.0 always populates
	// these required fields; the guards only matter for test fixtures that
	// pre-date the v2 schema.
	const tagEntries = meta.tags?.entries ?? [];
	const jsonLd = meta.jsonLd ?? [];
	const speculationRules = meta.speculationRules ?? [];
	const tag_count = tagEntries.length;
	const jsonld_count = jsonLd.length + speculationRules.length;
	const providers = new Set<string>();
	for (const entry of tagEntries) {
		providers.add(entry.provider);
	}
	const tags_providers_csv = [...providers].toSorted().join(',');
	return { tag_count, jsonld_count, tags_providers_csv };
}
