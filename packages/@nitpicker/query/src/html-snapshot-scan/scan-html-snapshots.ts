import type {
	HtmlSnapshot,
	MatchedSnapshotPage,
	ScanHtmlSnapshotsParams,
	ScanHtmlSnapshotsResult,
} from './types.js';

import { decodeStoredBlob } from '@nitpicker/archive/decode-html-blob';

import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

import { createHtmlSnapshotCandidateQuery } from './create-html-snapshot-candidate-query.js';
import { SCAN_CHUNK } from './scan-chunk.js';

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
 * Judges every distinct stored HTML snapshot of the searchable pages and
 * expands the matching snapshots to their pages. The shared scan behind
 * `searchHtml` and `matchSelector`.
 *
 * Design: there is no FTS index and snapshots are zstd BLOBs, so this is a
 * linear scan. `page_html_blobs` is content-addressable (identical HTML is
 * stored once), so the scan walks the **distinct hashes** of the candidate
 * pages (`createHtmlSnapshotCandidateQuery`) in `SCAN_CHUNK`-row keyset
 * chunks and decompresses each snapshot once however many pages share it;
 * snapshots no candidate page references are never read. Only the matched
 * hashes are retained, and page ids are resolved afterwards in
 * `SQLITE_IN_CHUNK` batches. Pages without a stored snapshot cannot match —
 * compare `candidatePages` with the archive's page total to tell "no match"
 * from "nothing was scanned".
 * @param params - The archive, page filters, snapshot judge and progress callback.
 * @returns Matched pages in page-id order plus scan totals.
 * @example
 * const { matchedPages, scannedSnapshots } = await scanHtmlSnapshots({
 *   knex: accessor.getKnex(),
 *   matches: ({ html }) => html.includes('fonts.example.org'),
 *   onProgress: (message) => console.error(message),
 * });
 */
export async function scanHtmlSnapshots(
	params: ScanHtmlSnapshotsParams,
): Promise<ScanHtmlSnapshotsResult> {
	const { knex, filters, matches, onProgress } = params;
	const candidates = () => createHtmlSnapshotCandidateQuery(knex, filters);

	const [hashTotalRow] = await candidates().countDistinct<{ count: number | string }[]>({
		count: 'phr.hash',
	});
	const hashTotal = Number(hashTotalRow?.count ?? 0);
	const [pageTotalRow] = await candidates().countDistinct<{ count: number | string }[]>({
		count: 'ci.id',
	});
	const candidatePages = Number(pageTotalRow?.count ?? 0);

	const matchedHashes: Buffer[] = [];
	let scanned = 0;
	let lastHash: Buffer | null = null;
	for (;;) {
		const chunkQuery = candidates()
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
			const hash = toBuffer(blob.hash);
			const snapshot: HtmlSnapshot = {
				// Lazy: most judges never read the key, and this runs once per snapshot.
				get hash() {
					return hash.toString('hex');
				},
				html: decodeStoredBlob(blob.body, blob.codec),
			};
			if (matches(snapshot)) {
				matchedHashes.push(hash);
			}
		}
		scanned += hashes.length;
		lastHash = hashes.at(-1)!;
		onProgress?.(`Scanning HTML snapshots: ${scanned} / ${hashTotal}`);
	}

	const matchedPages: MatchedSnapshotPage[] = [];
	for (let i = 0; i < matchedHashes.length; i += SQLITE_IN_CHUNK) {
		const rows = (await candidates()
			.whereIn('phr.hash', matchedHashes.slice(i, i + SQLITE_IN_CHUNK))
			.select('phr.page_id as pageId', 'phr.hash as hash')) as {
			pageId: number;
			hash: Uint8Array;
		}[];
		for (const row of rows) {
			matchedPages.push({ pageId: row.pageId, hash: toBuffer(row.hash).toString('hex') });
		}
	}
	matchedPages.sort((a, b) => a.pageId - b.pageId);

	return {
		matchedPages,
		matchedSnapshots: matchedHashes.length,
		scannedSnapshots: scanned,
		candidatePages,
	};
}
