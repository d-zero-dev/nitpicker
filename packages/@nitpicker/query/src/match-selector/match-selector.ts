import type { MatchSelectorOptions, MatchSelectorResult } from '../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { decodeStoredBlob } from '@nitpicker/crawler';

import { excludeSkippedPages } from '../exclude-skipped-pages.js';
import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

import { compileSelector } from './compile-selector.js';
import { htmlMatchesSelector } from './html-matches-selector.js';
import { planSelectorMatch } from './plan-selector-match.js';
import { SCAN_CHUNK } from './scan-chunk.js';

/**
 * Normalises a hash BLOB to a `Buffer`. libsql returns BLOB columns as
 * `ArrayBuffer`, which it then refuses to bind back as a query parameter,
 * so every hash read from a row is converted before reuse in a `where`.
 * @param hash - The raw BLOB value as returned by the driver.
 * @returns The same bytes as a `Buffer`.
 */
function toBuffer(hash: Uint8Array | ArrayBuffer): Buffer {
	return Buffer.from(hash as ArrayBuffer);
}

/**
 * The in-scope pages that have a stored HTML snapshot — the same page set
 * `searchHtml` scans, so the two HTML searches never disagree about what
 * is searchable.
 * @param knex - The archive's Knex instance.
 * @returns A fresh query over `page_html_ref` joined to its page.
 */
function createCandidateQuery(knex: Knex): Knex.QueryBuilder {
	return knex('page_html_ref as phr')
		.join('content_items as ci', 'ci.id', 'phr.page_id')
		.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'));
}

/**
 * Lists the pages whose stored HTML snapshot contains an element matching
 * a CSS selector, without running any analyze plugin and without writing
 * to the archive.
 *
 * Design: the selector is validated first (an unsupported one fails before
 * the archive is touched), then planned for three layers of increasing
 * cost — a regular expression over start tags for single-compound
 * selectors, an ordered-literal prefilter, and an open-element stack for
 * combinators and sibling-position tests. See `htmlMatchesSelector`.
 * Like `searchHtml`, the scan walks the **distinct hashes** of the
 * in-scope pages in keyset chunks, so identical HTML is decompressed and
 * judged once however many pages share it, and snapshots no live page
 * references are never read. Pages without a stored snapshot cannot match
 * — compare `candidatePages` with the summary's total to tell "no match"
 * from "nothing was scanned".
 *
 * The verdict is about the stored string read as markup with balanced
 * tags; it is not guaranteed to equal the verdict on the DOM the string
 * was serialized from (serialization is not injective), and `<template>`
 * and raw text element (`script`, `style`, `noscript`, ...) content is
 * not searched.
 * @param accessor - The archive accessor to query.
 * @param options - The selector, pagination and progress callback.
 * @returns Matching pages sliced by `offset` / `limit`, plus totals and layer counters.
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

	const [hashTotalRow] = await createCandidateQuery(knex).countDistinct<
		{ count: number | string }[]
	>({ count: 'phr.hash' });
	const hashTotal = Number(hashTotalRow?.count ?? 0);
	const [pageTotalRow] = await createCandidateQuery(knex).countDistinct<
		{ count: number | string }[]
	>({ count: 'ci.id' });
	const candidatePages = Number(pageTotalRow?.count ?? 0);

	const matchedHashes: Buffer[] = [];
	let scanned = 0;
	let prefiltered = 0;
	let tokenized = 0;
	let lastHash: Buffer | null = null;
	for (;;) {
		const chunkQuery = createCandidateQuery(knex)
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
			const outcome = htmlMatchesSelector({
				plan,
				html: decodeStoredBlob(blob.body, blob.codec),
			});
			if (outcome.prefiltered) {
				prefiltered++;
			}
			if (outcome.tokenized) {
				tokenized++;
			}
			if (outcome.matched) {
				matchedHashes.push(toBuffer(blob.hash));
			}
		}
		scanned += hashes.length;
		lastHash = hashes.at(-1)!;
		options.onProgress?.(`Scanning HTML snapshots: ${scanned} / ${hashTotal}`);
	}

	const matchedPageIds: number[] = [];
	for (let i = 0; i < matchedHashes.length; i += SQLITE_IN_CHUNK) {
		const rows = (await createCandidateQuery(knex)
			.whereIn('phr.hash', matchedHashes.slice(i, i + SQLITE_IN_CHUNK))
			.select('phr.page_id as pageId')) as { pageId: number }[];
		for (const row of rows) {
			matchedPageIds.push(row.pageId);
		}
	}
	matchedPageIds.sort((a, b) => a - b);

	const slice = matchedPageIds.slice(offset, offset + limit);
	const urlByPageId = new Map<number, string>();
	for (let i = 0; i < slice.length; i += SQLITE_IN_CHUNK) {
		const urlRows = (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('ci.id', slice.slice(i, i + SQLITE_IN_CHUNK))
			.select('ci.id as pageId', 'ur.url as url')) as {
			pageId: number;
			url: string;
		}[];
		for (const row of urlRows) {
			urlByPageId.set(row.pageId, row.url);
		}
	}

	return {
		selector: options.selector,
		items: slice.map((pageId) => ({ pageId, url: urlByPageId.get(pageId)! })),
		total: matchedPageIds.length,
		offset,
		limit,
		scannedSnapshots: scanned,
		candidatePages,
		prefilteredSnapshots: prefiltered,
		tokenizedSnapshots: tokenized,
		matchedSnapshots: matchedHashes.length,
	};
}
