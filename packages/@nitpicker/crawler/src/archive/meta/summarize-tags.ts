import type { TagRow, TagsSummary } from './types.js';

/**
 * Builds the {@link TagsSummary} object returned by `get-page-detail` from a
 * page's tag rows.
 *
 * Provides a `provider → unique IDs[]` map so consumers can answer questions
 * like "what GTM containers are on this page?" without fetching the full
 * `categories` / `sources` JSON columns.
 *
 * IDs within each provider are sorted and de-duplicated. Providers with no
 * `externalId` rows still appear in the map with an empty `[]` so the
 * caller knows the provider was detected.
 * @param rows - All `page_tags` rows for one page.
 * @returns Summary with `count` and `providerIds` map.
 */
export function summarizeTags(rows: readonly TagRow[]): TagsSummary {
	const providerIds: Record<string, Set<string>> = {};
	for (const row of rows) {
		if (!(row.provider in providerIds)) {
			providerIds[row.provider] = new Set<string>();
		}
		if (row.externalId !== null) {
			providerIds[row.provider]!.add(row.externalId);
		}
	}
	const sorted: Record<string, readonly string[]> = {};
	for (const provider of Object.keys(providerIds).toSorted()) {
		sorted[provider] = [...providerIds[provider]!].toSorted();
	}
	return {
		count: rows.length,
		providerIds: sorted,
	};
}
