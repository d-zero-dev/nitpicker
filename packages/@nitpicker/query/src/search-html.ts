import type { SearchHtmlOptions, SearchHtmlResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';

import { searchHtmlSnapshots } from '@nitpicker/archive/html-snapshot/search-html-snapshots';

import { compileSearchPattern } from './compile-search-pattern.js';
import { resolvePageUrls } from './html-snapshot-scan/resolve-page-urls.js';
import { scanHtmlSnapshots } from './html-snapshot-scan/scan-html-snapshots.js';

const DEFAULT_SNIPPET_LENGTH = 160;

/** The native search takes the snippet size as a `u32`. */
const MAX_SNIPPET_LENGTH = 4_294_967_295;

interface HashMatch {
	matchCount: number;
	snippet: string;
}

/**
 * Searches the stored HTML snapshots of every in-scope page for a string or
 * regular expression, without writing to the archive.
 *
 * The search runs against the raw markup that `getPageHtml` returns, so
 * `<script>`, `<style>`, inline `style` and every attribute are searchable.
 *
 * Pattern contract: a plain string is a literal substring; `/source/flags`
 * is a regular expression in the syntax of Rust's `regex` crate — no
 * backreferences or look-around, but matching time is linear in the
 * document. The match unit is a Unicode scalar value (`.` matches an emoji
 * once), `\d` `\w` `\s` `\b` follow Unicode, `.` stops only at `\n`, and
 * `matchCount` counts non-overlapping matches. Flags `i` `m` `s` take
 * effect, `g` and `u` are accepted and always on, `d` `v` `y` are rejected.
 * The snippet is a window of `snippetLength` characters centred on the
 * first match, with whitespace collapsed.
 *
 * Design: the scan is `scanHtmlSnapshots` — a linear walk over the
 * **distinct hashes** of the in-scope pages that reads each snapshot once,
 * no matter how many pages share it, over the same page set as
 * `matchSelector`. Decompressing and matching run natively
 * (`@nitpicker/core`, via `searchHtmlSnapshots`), in parallel, a batch at a
 * time. Only per-hash `{ matchCount, snippet }` is retained; page ids are
 * resolved afterwards. Pages without a stored snapshot (non-HTML, redirect
 * sources, archives crawled without HTML storage) cannot match — compare
 * `candidatePages` with `summary.totalPages` to tell "no match" from
 * "nothing was scanned".
 * @param accessor - The archive accessor to query.
 * @param options - The pattern, page filters, and pagination.
 * @returns Matching pages sliced by `offset` / `limit`, plus totals.
 * @throws {SyntaxError} If `pattern` is a `/…/flags` form with an unsupported flag, or an invalid or unsupported regular expression.
 * @throws {Error} If `pattern` matches the empty string.
 * @throws {RangeError} If `snippetLength` is not a non-negative integer.
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
	if (
		!Number.isInteger(snippetLength) ||
		snippetLength < 0 ||
		snippetLength > MAX_SNIPPET_LENGTH
	) {
		throw new RangeError(
			`snippetLength must be an integer between 0 and ${MAX_SNIPPET_LENGTH}, got ${snippetLength}.`,
		);
	}

	const pattern = compileSearchPattern(options.pattern, { literal: options.literal });

	const matches = new Map<string, HashMatch>();
	const { matchedPages, scannedSnapshots, candidatePages } = await scanHtmlSnapshots({
		knex,
		filters: options,
		judgeBatch: async (snapshots) => {
			const outcomes = await searchHtmlSnapshots({ pattern, snippetLength, snapshots });
			return outcomes.map((outcome, index) => {
				if (outcome.matchCount === 0) {
					return false;
				}
				matches.set(snapshots[index]!.hash, {
					matchCount: outcome.matchCount,
					snippet: outcome.snippet,
				});
				return true;
			});
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
