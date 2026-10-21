import type { PageDirKeys } from './types.js';

import { computePageDirKeys } from './compute-page-dir-keys.js';

/** Minimal page shape this function needs from `sourceRows`. */
export interface DisplayTitleSourceRow {
	readonly id: number;
	readonly url: string;
	readonly title: string | null;
}

/**
 * Computes each page's title with its directory index page's title
 * stripped out (e.g. removing a site-name suffix a child page shares with
 * its directory's landing page) — the Page List report's historical
 * "Full Title" vs shortened "Title" distinction.
 *
 * Two-pass over the full row set, unlike the report's historical single
 * incremental pass over one page-processing batch at a time: every
 * directory's index title is collected first, so a page's display title no
 * longer depends on whether its directory's index page happened to be
 * scanned before it (previously `content_items.id` order, unrelated to
 * directory structure — a child page id-ordered before its index page kept
 * its untrimmed title, a scan-order bug this full-archive computation
 * removes by construction rather than by ordering the scan).
 * @param rows - Every page's id/url/title, from `sourceRows`.
 * @param dirKeys - The rows' directory keys, when the caller already has them
 *   (`buildViewerReadModel` computes them once for every consumer). Defaults to
 *   parsing `rows` here. Must have been computed from this same `rows` array.
 * @returns Map from `page_id` to its display title. A `null` source title
 *   maps to `null`; a title with nothing left to strip maps to itself
 *   verbatim.
 */
export function computeDisplayTitleByPageId(
	rows: readonly DisplayTitleSourceRow[],
	dirKeys: PageDirKeys = computePageDirKeys(rows),
): Map<number, string | null> {
	const indexTitleByDirname = new Map<string, string>();
	for (const [i, row] of rows.entries()) {
		if (!row.title) {
			continue;
		}
		if (dirKeys.isIndexAt(i)) {
			indexTitleByDirname.set(dirKeys.dirKeyAt(i)!, row.title);
		}
	}

	const result = new Map<number, string | null>();
	for (const [i, row] of rows.entries()) {
		if (!row.title) {
			result.set(row.id, row.title);
			continue;
		}
		if (!dirKeys.isParsedAt(i)) {
			result.set(row.id, row.title);
			continue;
		}
		const dirKey = dirKeys.dirKeyAt(i)!;
		const parentDirKey = dirKeys.parentDirKeyAt(i)!;
		const dirTitle = dirKeys.isIndexAt(i)
			? (indexTitleByDirname.get(parentDirKey) ?? indexTitleByDirname.get(dirKey))
			: (indexTitleByDirname.get(dirKey) ?? indexTitleByDirname.get(parentDirKey));
		if (dirTitle && row.title.includes(dirTitle)) {
			const stripped = row.title.replace(dirTitle, '').replaceAll(/\||｜/g, '').trim();
			result.set(row.id, stripped || row.title);
		} else {
			result.set(row.id, row.title);
		}
	}
	return result;
}
