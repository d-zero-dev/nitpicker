import type { JsonLdRow, JsonLdSummary } from './types.js';

/**
 * Builds the {@link JsonLdSummary} object returned by `get-page-detail` from a
 * page's JSON-LD rows.
 *
 * Why summary: the raw payload of a single page's JSON-LD can reach several
 * MB on e-commerce sites (Amazon product page = 50 schemas × 50KB). Returning
 * that inline blows up MCP / LLM token budgets. The summary preserves the
 * shape of the data (counts + unique types + parse error count) so consumers
 * can decide whether to drill in via `get-page-jsonld(url)`.
 *
 * Entries with `type === null` are surfaced as `'(unknown)'` so the type
 * list is enumerable without sentinel handling on the consumer side.
 * @param rows - All `page_jsonld` rows for one page.
 * @returns Summary with `count`, sorted unique `types[]`, and `parseErrorCount`.
 */
export function summarizeJsonLd(rows: readonly JsonLdRow[]): JsonLdSummary {
	const types = new Set<string>();
	let parseErrorCount = 0;
	for (const row of rows) {
		types.add(row.type ?? '(unknown)');
		if (row.parseError !== null) parseErrorCount++;
	}
	return {
		count: rows.length,
		types: [...types].toSorted(),
		parseErrorCount,
	};
}
