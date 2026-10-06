import type { SearchHtmlOptions, SearchHtmlResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { strToRegex } from '@d-zero/shared/str-to-regex';
import { decodeStoredBlob } from '@nitpicker/crawler';

import { excludeSkippedPages } from './exclude-skipped-pages.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/** Distinct snapshots decompressed per round trip; bounds peak memory. */
const SCAN_CHUNK = 500;

const DEFAULT_SNIPPET_LENGTH = 160;

interface HashMatch {
	matchCount: number;
	snippet: string;
}

/**
 * Normalises a hash BLOB to a `Buffer`. libsql returns BLOB columns as
 * `ArrayBuffer`, which it then refuses to bind back as a query parameter
 * ("can only bind … buffers"), so every hash read from a row is converted
 * before being reused in a `where` clause.
 * @param hash - The raw BLOB value as returned by the driver.
 * @returns The same bytes as a `Buffer`.
 */
function toBuffer(hash: Uint8Array | ArrayBuffer): Buffer {
	return Buffer.from(hash as ArrayBuffer);
}

/**
 * Hex key for a hash BLOB, usable as a `Map` key.
 * @param hash - The raw SHA-256 BLOB value.
 * @returns The lowercase hex string.
 */
function hashKey(hash: Uint8Array | ArrayBuffer): string {
	return toBuffer(hash).toString('hex');
}

/**
 * Builds the base query of in-scope pages that have a stored HTML snapshot.
 * @param knex - The archive's Knex instance.
 * @param options - Page-level filters.
 * @returns A fresh query over `page_html_ref` joined to the page and its URL.
 */
function createCandidateQuery(
	knex: Knex,
	options: Pick<SearchHtmlOptions, 'urlPattern' | 'directory'>,
): Knex.QueryBuilder {
	const query = knex('page_html_ref as phr')
		.join('content_items as ci', 'ci.id', 'phr.page_id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'));
	if (options.urlPattern) {
		query.where('ur.url', 'like', options.urlPattern);
	}
	if (options.directory) {
		const dir = options.directory.endsWith('/')
			? options.directory
			: `${options.directory}/`;
		query.where('ur.url', 'like', `%${dir}%`);
	}
	return query;
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
 * regular expression, without running any analyze plugin and without
 * writing to the archive.
 *
 * The search runs against the raw markup that `getPageHtml` returns, so
 * `<script>`, `<style>`, inline `style` and every attribute are searchable —
 * unlike `@nitpicker/analyze-search`, which matches DOM text nodes only.
 *
 * Design: there is no FTS index and snapshots are zstd BLOBs, so this is a
 * linear scan. `page_html_blobs` is content-addressable (identical HTML is
 * stored once), so the scan walks the **distinct hashes** of the in-scope
 * pages in 500-row keyset chunks and decompresses each snapshot once, no
 * matter how many pages share it. Only per-hash `{ matchCount, snippet }`
 * is retained; page ids are resolved afterwards. Pages without a stored
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

	const [hashTotalRow] = await createCandidateQuery(knex, options).countDistinct<
		{ count: number | string }[]
	>({ count: 'phr.hash' });
	const hashTotal = Number(hashTotalRow?.count ?? 0);
	const [pageTotalRow] = await createCandidateQuery(knex, options).countDistinct<
		{ count: number | string }[]
	>({ count: 'ci.id' });
	const candidatePages = Number(pageTotalRow?.count ?? 0);

	const matches = new Map<string, HashMatch>();
	const matchedHashes: Buffer[] = [];
	let scanned = 0;
	let lastHash: Buffer | null = null;
	for (;;) {
		const chunkQuery = createCandidateQuery(knex, options)
			.distinct('phr.hash as hash')
			.orderBy('phr.hash')
			.limit(SCAN_CHUNK);
		if (lastHash) {
			chunkQuery.where('phr.hash', '>', lastHash);
		}
		const hashes = ((await chunkQuery) as { hash: Uint8Array }[]).map((row) =>
			toBuffer(row.hash),
		);
		if (hashes.length === 0) {
			break;
		}
		const blobs = (await knex('page_html_blobs')
			.whereIn('hash', hashes)
			.select('hash', 'body', 'codec')) as {
			hash: Uint8Array;
			body: Uint8Array;
			codec: string;
		}[];
		for (const blob of blobs) {
			const html = decodeStoredBlob(blob.body, blob.codec);
			let matchCount = 0;
			let snippet = '';
			for (const match of html.matchAll(regex)) {
				if (matchCount === 0) {
					snippet = buildSnippet(html, match.index, match[0].length, snippetLength);
				}
				matchCount++;
			}
			if (matchCount > 0) {
				matches.set(hashKey(blob.hash), { matchCount, snippet });
				matchedHashes.push(toBuffer(blob.hash));
			}
		}
		scanned += hashes.length;
		lastHash = hashes.at(-1)!;
		options.onProgress?.(`Scanning HTML snapshots: ${scanned} / ${hashTotal}`);
	}

	const matchedPages: { pageId: number; hash: string }[] = [];
	for (let i = 0; i < matchedHashes.length; i += SQLITE_IN_CHUNK) {
		const rows = (await createCandidateQuery(knex, options)
			.whereIn('phr.hash', matchedHashes.slice(i, i + SQLITE_IN_CHUNK))
			.select('phr.page_id as pageId', 'phr.hash as hash')) as {
			pageId: number;
			hash: Uint8Array;
		}[];
		for (const row of rows) {
			matchedPages.push({ pageId: row.pageId, hash: hashKey(row.hash) });
		}
	}
	matchedPages.sort((a, b) => a.pageId - b.pageId);

	const slice = matchedPages.slice(offset, offset + limit);
	const urlByPageId = new Map<number, string>();
	for (let i = 0; i < slice.length; i += SQLITE_IN_CHUNK) {
		const urlRows = (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn(
				'ci.id',
				slice.slice(i, i + SQLITE_IN_CHUNK).map((page) => page.pageId),
			)
			.select('ci.id as pageId', 'ur.url as url')) as {
			pageId: number;
			url: string;
		}[];
		for (const row of urlRows) {
			urlByPageId.set(row.pageId, row.url);
		}
	}

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
		scannedSnapshots: scanned,
		candidatePages,
	};
}
