import { tryParseUrl } from '@d-zero/shared/parse-url';

import { originDirnameKey } from './origin-dirname-key.js';

/** Minimal page shape this function needs from `sourceRows`. */
export interface DirIndexInboundLinkCountSourceRow {
	readonly id: number;
	readonly url: string;
}

/**
 * Computes, for every directory-index page (e.g. `/blog/index.html`,
 * `/blog/`), the combined inbound-link count of every index page sharing
 * that directory — the Page List report's "Internal Referrers" value for a
 * directory's landing page counts links to any of its index variants as one
 * shared total, not just links that happened to target this exact URL.
 *
 * Symmetric by construction: every index page sharing a directory receives
 * the same combined total. The report's historical per-batch
 * implementation gave the first-encountered index page only its own count
 * and every later one the combined total — an artifact of accumulating into
 * a shared array as pages streamed by, not an intentional asymmetry; this
 * full-archive computation has no "first" to special-case.
 * @param rows - Every page's id/url, from `sourceRows`.
 * @param inboundLinkCountByPageId - Each page's own inbound link count
 *   (distinct-referrer count from `viewer_anchor_facts`), keyed by
 *   `page_id`. A page with no entry is treated as `0`.
 * @returns Map from an index page's `page_id` to its directory's combined
 *   inbound link count. Non-index pages have no entry.
 */
export function computeDirIndexInboundLinkCountByPageId(
	rows: readonly DirIndexInboundLinkCountSourceRow[],
	inboundLinkCountByPageId: ReadonlyMap<number, number>,
): Map<number, number> {
	const indexPageIdsByDirname = new Map<string, number[]>();
	for (const row of rows) {
		const parsed = tryParseUrl(row.url);
		if (!parsed?.isIndex) {
			continue;
		}
		const key = originDirnameKey(parsed);
		const existing = indexPageIdsByDirname.get(key);
		if (existing) {
			existing.push(row.id);
		} else {
			indexPageIdsByDirname.set(key, [row.id]);
		}
	}

	const result = new Map<number, number>();
	for (const pageIds of indexPageIdsByDirname.values()) {
		const total = pageIds.reduce(
			(sum, id) => sum + (inboundLinkCountByPageId.get(id) ?? 0),
			0,
		);
		for (const id of pageIds) {
			result.set(id, total);
		}
	}
	return result;
}
