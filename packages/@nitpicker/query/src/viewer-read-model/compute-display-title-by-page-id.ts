import { tryParseUrl } from '@d-zero/shared/parse-url';

import { originDirnameKey } from './origin-dirname-key.js';

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
 * @returns Map from `page_id` to its display title. A `null` source title
 *   maps to `null`; a title with nothing left to strip maps to itself
 *   verbatim.
 */
export function computeDisplayTitleByPageId(
	rows: readonly DisplayTitleSourceRow[],
): Map<number, string | null> {
	const indexTitleByDirname = new Map<string, string>();
	for (const row of rows) {
		if (!row.title) {
			continue;
		}
		const parsed = tryParseUrl(row.url);
		if (parsed?.isIndex) {
			indexTitleByDirname.set(originDirnameKey(parsed), row.title);
		}
	}

	const result = new Map<number, string | null>();
	for (const row of rows) {
		if (!row.title) {
			result.set(row.id, row.title);
			continue;
		}
		const parsed = tryParseUrl(row.url);
		if (!parsed) {
			result.set(row.id, row.title);
			continue;
		}
		const dirKey = originDirnameKey(parsed);
		const parentDir = `/${parsed.paths.slice(0, -2).join('/')}`;
		const parentDirKey = originDirnameKey({ ...parsed, dirname: parentDir });
		const dirTitle = parsed.isIndex
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
