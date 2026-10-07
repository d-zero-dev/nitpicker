import type { MatchSelectorOptions, MatchSelectorResult } from '../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { resolvePageUrls } from '../html-snapshot-scan/resolve-page-urls.js';
import { scanHtmlSnapshots } from '../html-snapshot-scan/scan-html-snapshots.js';

import { compileSelector } from './compile-selector.js';
import { htmlMatchesSelector } from './html-matches-selector.js';
import { planSelectorMatch } from './plan-selector-match.js';

/**
 * Lists the pages whose stored HTML snapshot contains an element matching
 * a CSS selector, without running any analyze plugin and without writing
 * to the archive.
 *
 * Design: the selector is validated first (an unsupported one fails before
 * the archive is touched), then planned for three stages of increasing
 * cost — a regular expression over start tags for single-compound
 * selectors, an ordered-literal prefilter, and an open-element stack for
 * combinators and sibling-position tests. See `htmlMatchesSelector`.
 * The scan is `scanHtmlSnapshots`, shared with `searchHtml` so both search
 * the same pages: it walks the **distinct hashes** of the in-scope pages,
 * so identical HTML is decompressed and judged once however many pages
 * share it. Pages without a stored snapshot cannot match
 * — compare `candidatePages` with the summary's total to tell "no match"
 * from "nothing was scanned".
 *
 * The verdict is about the stored string read as markup with balanced
 * tags; it is not guaranteed to equal the verdict on the DOM the string
 * was serialized from (serialization is not injective), and `<template>`
 * and raw text element (`script`, `style`, `noscript`, ...) content is
 * not searched.
 * @param accessor - The archive accessor to query.
 * @param options - The selector, page filters, pagination and progress callback.
 * @returns Matching pages sliced by `offset` / `limit`, plus totals and stage counters.
 * @throws {UnsupportedSelectorError} If the selector is invalid or outside the supported grammar.
 * @example
 * const { items, total } = await matchSelector(accessor, {
 *   selector: 'nav > a[href^="/products/"]',
 *   limit: 20,
 * });
 * for (const item of items) {
 *   console.log(item.pageId, item.url);
 * }
 */
export async function matchSelector(
	accessor: ArchiveAccessor,
	options: MatchSelectorOptions,
): Promise<MatchSelectorResult> {
	const plan = planSelectorMatch(compileSelector(options.selector));
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	let prefiltered = 0;
	let tokenized = 0;
	const { matchedPages, matchedSnapshots, scannedSnapshots, candidatePages } =
		await scanHtmlSnapshots({
			knex,
			filters: options,
			matches: ({ html }) => {
				const outcome = htmlMatchesSelector({ plan, html });
				if (outcome.prefiltered) {
					prefiltered++;
				}
				if (outcome.tokenized) {
					tokenized++;
				}
				return outcome.matched;
			},
			onProgress: options.onProgress,
		});

	const slice = matchedPages.slice(offset, offset + limit).map((page) => page.pageId);
	const urlByPageId = await resolvePageUrls(knex, slice);

	return {
		selector: options.selector,
		items: slice.map((pageId) => ({ pageId, url: urlByPageId.get(pageId)! })),
		total: matchedPages.length,
		offset,
		limit,
		scannedSnapshots,
		candidatePages,
		prefilteredSnapshots: prefiltered,
		tokenizedSnapshots: tokenized,
		matchedSnapshots,
	};
}
