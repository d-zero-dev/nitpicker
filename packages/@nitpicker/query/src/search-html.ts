import type { SearchHtmlOptions, SearchHtmlResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { strToRegex } from '@d-zero/shared/str-to-regex';

import { resolvePageUrls } from './html-snapshot-scan/resolve-page-urls.js';
import { scanHtmlSnapshots } from './html-snapshot-scan/scan-html-snapshots.js';

const DEFAULT_SNIPPET_LENGTH = 160;

interface HashMatch {
	matchCount: number;
	snippet: string;
}

/**
 * Whitespace-collapsed window of `snippetLength` characters centred on a match.
 * @param html - The full HTML.
 * @param index - Start index of the match.
 * @param matchLength - Length of the match.
 * @param snippetLength - Window size in characters.
 * @returns The collapsed snippet.
 */
function buildSnippet(
	html: string,
	index: number,
	matchLength: number,
	snippetLength: number,
): string {
	const start = Math.max(
		0,
		index + Math.floor(matchLength / 2) - Math.floor(snippetLength / 2),
	);
	return html
		.slice(start, start + snippetLength)
		.replaceAll(/\s+/g, ' ')
		.trim();
}

/**
 * Searches the stored HTML snapshots of every in-scope page for a string or
 * regular expression, without writing to the archive.
 *
 * The search runs against the raw markup that `getPageHtml` returns, so
 * `<script>`, `<style>`, inline `style` and every attribute are searchable.
 *
 * Design: the scan is `scanHtmlSnapshots` — a linear walk over the
 * **distinct hashes** of the in-scope pages that decompresses each snapshot
 * once, no matter how many pages share it, over the same page set as
 * `matchSelector`. Only per-hash `{ matchCount, snippet }` is retained;
 * page ids are resolved afterwards. Pages without a stored
 * snapshot (non-HTML, redirect sources, archives crawled without HTML
 * storage) cannot match — compare `candidatePages` with
 * `summary.totalPages` to tell "no match" from "nothing was scanned".
 * @param accessor - The archive accessor to query.
 * @param options - The pattern, page filters, and pagination.
 * @returns Matching pages sliced by `offset` / `limit`, plus totals.
 * @throws {SyntaxError} If `pattern` is a `/…/flags` form with an invalid regular expression.
 * @example
 * const { items, total } = await searchHtml(accessor, {
 *   pattern: 'fonts.example.org',
 *   limit: 20,
 * });
 * for (const item of items) {
 *   console.log(item.url, item.matchCount, item.snippet);
 * }
 */
export async function searchHtml(
	accessor: ArchiveAccessor,
	options: SearchHtmlOptions,
): Promise<SearchHtmlResult> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const snippetLength = options.snippetLength ?? DEFAULT_SNIPPET_LENGTH;

	const parsed = strToRegex(options.pattern);
	// `g` is required by `matchAll`; `y` (sticky) would restrict matches to
	// contiguous runs from the start and silently report "no match".
	const flags = [...new Set(`${parsed.flags.replaceAll('y', '')}g`)].join('');
	const regex = new RegExp(parsed.source, flags);
	if (regex.test('')) {
		throw new Error(
			'pattern must not match the empty string (it would match at every position of every snapshot).',
		);
	}
	regex.lastIndex = 0;

	const matches = new Map<string, HashMatch>();
	const { matchedPages, scannedSnapshots, candidatePages } = await scanHtmlSnapshots({
		knex,
		filters: options,
		matches: ({ hash, html }) => {
			let matchCount = 0;
			let snippet = '';
			for (const match of html.matchAll(regex)) {
				if (matchCount === 0) {
					snippet = buildSnippet(html, match.index, match[0].length, snippetLength);
				}
				matchCount++;
			}
			if (matchCount === 0) {
				return false;
			}
			matches.set(hash, { matchCount, snippet });
			return true;
		},
		onProgress: options.onProgress,
	});

	const slice = matchedPages.slice(offset, offset + limit);
	const urlByPageId = await resolvePageUrls(
		knex,
		slice.map((page) => page.pageId),
	);

	return {
		items: slice.map((page) => {
			const match = matches.get(page.hash)!;
			return {
				url: urlByPageId.get(page.pageId) ?? '',
				matchCount: match.matchCount,
				snippet: match.snippet,
			};
		}),
		total: matchedPages.length,
		offset,
		limit,
		scannedSnapshots,
		candidatePages,
	};
}
