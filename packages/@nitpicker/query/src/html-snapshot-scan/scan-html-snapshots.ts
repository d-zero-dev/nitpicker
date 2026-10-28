import type {
	MatchedSnapshotPage,
	ScanHtmlSnapshotsParams,
	ScanHtmlSnapshotsResult,
	StoredSnapshotBlob,
} from './types.js';
import type { Knex } from 'knex';

import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

import { createHtmlSnapshotCandidateQuery } from './create-html-snapshot-candidate-query.js';
import { estimateDecodedBytes } from './estimate-decoded-bytes.js';
import { SCAN_BATCH_BYTES } from './scan-batch-bytes.js';
import { SCAN_CHUNK } from './scan-chunk.js';

/** A `page_html_blobs` row of a walked hash. */
interface BlobRow {
	readonly hash: Buffer;
	readonly body: Uint8Array;
	readonly codec: string;
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
 * Splits rows into consecutive batches, closing a batch once the estimated
 * decoded size of its snapshots reaches `SCAN_BATCH_BYTES` (a snapshot that
 * alone exceeds it gets a batch of its own).
 * @param rows - The rows to split, in order.
 * @returns The batches, in order.
 */
function splitIntoBatches(rows: readonly BlobRow[]): BlobRow[][] {
	const batches: BlobRow[][] = [];
	let current: BlobRow[] = [];
	let bytes = 0;
	for (const row of rows) {
		current.push(row);
		bytes += estimateDecodedBytes(row);
		if (bytes >= SCAN_BATCH_BYTES) {
			batches.push(current);
			current = [];
			bytes = 0;
		}
	}
	if (current.length > 0) {
		batches.push(current);
	}
	return batches;
}

/**
 * Reads the blob rows of a chunk of hashes, in whatever order the database
 * returns them (each row carries its own hash).
 * @param knex - The archive's connection.
 * @param hashes - The hashes to read.
 * @returns The rows of those hashes.
 */
async function readBlobRows(knex: Knex, hashes: readonly Buffer[]): Promise<BlobRow[]> {
	const rows = await knex('page_html_blobs')
		.whereIn('hash', hashes as Buffer[])
		.select<{ hash: Uint8Array; body: Uint8Array; codec: string }[]>(
			'hash',
			'body',
			'codec',
		);
	return rows.map((row) => ({
		hash: toBuffer(row.hash),
		// An `ArrayBuffer` from the driver, or a view of the right bytes: `Buffer.from`
		// shares the memory either way.
		body: toBuffer(row.body),
		codec: row.codec,
	}));
}

/**
 * Adds the hash of the snapshot a judge could not decode to its error, so a
 * corrupt blob can be traced to its row: the judge reports the position in the
 * batch (`snapshot <n> could not be decoded`), which means nothing outside it.
 * @param error - What the judge rejected with.
 * @param batch - The rows the judge was given, in order.
 * @returns The error, naming the snapshot's hash when the judge named a position.
 */
function nameFailedSnapshot(error: unknown, batch: readonly BlobRow[]): unknown {
	if (!(error instanceof Error)) {
		return error;
	}
	const position = /snapshot (\d+) could not be decoded/.exec(error.message)?.[1];
	const row = position === undefined ? undefined : batch[Number(position)];
	if (row === undefined) {
		return error;
	}
	return new Error(
		`${error.message} (page_html_blobs hash ${row.hash.toString('hex')})`,
		{
			cause: error,
		},
	);
}

/**
 * The hashes of the rows the scan's judge marks as matching.
 * @param params - The scan's parameters, which hold the judge.
 * @param rows - The blob rows of one chunk.
 * @returns The matching rows' hashes, in row order.
 */
async function findMatchedHashes(
	params: ScanHtmlSnapshotsParams,
	rows: readonly BlobRow[],
): Promise<Buffer[]> {
	const matched: Buffer[] = [];
	for (const batch of splitIntoBatches(rows)) {
		const verdicts = await params
			.judgeBatch(
				batch.map(({ hash, body, codec }): StoredSnapshotBlob => ({
					hash: hash.toString('hex'),
					body,
					codec,
				})),
			)
			.catch((error: unknown) => {
				throw nameFailedSnapshot(error, batch);
			});
		if (verdicts.length !== batch.length) {
			throw new Error(
				`The snapshot judge returned ${verdicts.length} verdicts for ${batch.length} snapshots.`,
			);
		}
		for (const [index, row] of batch.entries()) {
			if (verdicts[index]) {
				matched.push(row.hash);
			}
		}
	}
	return matched;
}

/**
 * Judges every distinct stored HTML snapshot of the searchable pages and
 * expands the matching snapshots to their pages. The shared scan behind
 * `searchHtml` and `matchSelector`.
 *
 * Design: there is no FTS index and snapshots are zstd BLOBs, so this is a
 * linear scan. `page_html_blobs` is content-addressable (identical HTML is
 * stored once), so the scan walks the **distinct hashes** of the candidate
 * pages (`createHtmlSnapshotCandidateQuery`), listed once in hash order, and
 * reads their blobs `SCAN_CHUNK` at a time. The list is held whole (32 bytes
 * a snapshot) rather than walked by keyset: that re-ran the candidate join,
 * `DISTINCT` and `ORDER BY` for every chunk, which cost more than the list.
 * Each chunk's rows are read in full before they are split into batches, as
 * the blobs of a chunk always were, so each snapshot is judged once
 * however many pages share it; snapshots no candidate page references are
 * never read. Only the matched hashes are retained, and page ids are
 * resolved afterwards in `SQLITE_IN_CHUNK` batches. Pages without a stored
 * snapshot cannot match — compare `candidatePages` with the archive's page
 * total to tell "no match" from "nothing was scanned".
 *
 * The judge, `judgeBatch`, sees the stored (still encoded) snapshots of a
 * chunk in batches whose estimated decoded size is bounded by
 * `SCAN_BATCH_BYTES`, so a native judge can decompress and judge them in
 * parallel without this scan holding the decoded documents; the next chunk is
 * read while the judge works on the current one (reading is most of the
 * time), at the price of one more chunk's stored bytes held. Each snapshot
 * carries the hash it was stored under, which is the key a judge keeps its
 * results by. A blob row is paired with the hash it came back with: `whereIn`
 * does not return rows in the order the hashes were asked for.
 * @param params - The archive, page filters, snapshot judge, progress callback and signal.
 * @returns Matched pages in page-id order plus scan totals.
 * @throws {unknown} The signal's reason when `params.signal` aborts: it is checked before
 *   each chunk is judged and before the matched pages are resolved.
 * @example
 * const { matchedPages, scannedSnapshots } = await scanHtmlSnapshots({
 *   knex: accessor.getKnex(),
 *   judgeBatch: async (batch) =>
 *     (await matchSelectorSnapshots({ plan, snapshots: batch })).map((v) => v.matched),
 *   onProgress: (message) => console.error(message),
 * });
 */
export async function scanHtmlSnapshots(
	params: ScanHtmlSnapshotsParams,
): Promise<ScanHtmlSnapshotsResult> {
	const { knex, filters, onProgress, signal } = params;
	const candidates = () => createHtmlSnapshotCandidateQuery(knex, filters);

	const walkedHashes = (
		(await candidates().distinct('phr.hash as hash').orderBy('phr.hash')) as {
			hash: Uint8Array;
		}[]
	).map((row) => toBuffer(row.hash));
	const hashTotal = walkedHashes.length;
	const [pageTotalRow] = await candidates().countDistinct<{ count: number | string }[]>({
		count: 'ci.id',
	});
	const candidatePages = Number(pageTotalRow?.count ?? 0);

	const matchedHashes: Buffer[] = [];
	let scanned = 0;
	// The judge runs off the event loop, so the next chunk is read while the
	// current one is judged.
	/**
	 * Starts reading the chunk that begins at `from`.
	 * @param from - Index into the walked hashes.
	 * @returns The chunk's blob rows.
	 */
	const readNext = (from: number): Promise<BlobRow[]> => {
		const read = readBlobRows(knex, walkedHashes.slice(from, from + SCAN_CHUNK));
		// A read that fails while an earlier chunk is still being judged must not
		// surface as an unhandled rejection; the loop awaits it (and throws) next.
		read.catch(() => {});
		return read;
	};
	let pending: Promise<BlobRow[]> | undefined =
		walkedHashes.length > 0 ? readNext(0) : undefined;
	try {
		for (let start = 0; start < walkedHashes.length; start += SCAN_CHUNK) {
			signal?.throwIfAborted();
			const rows = await pending!;
			const next = start + SCAN_CHUNK;
			pending = next < walkedHashes.length ? readNext(next) : undefined;

			matchedHashes.push(...(await findMatchedHashes(params, rows)));
			scanned += Math.min(SCAN_CHUNK, walkedHashes.length - start);
			onProgress?.(`Scanning HTML snapshots: ${scanned} / ${hashTotal}`);
		}
	} finally {
		// A scan that stops early (an abort, a failed judge) leaves the prefetched
		// read running; its caller may close the archive as soon as this rejects,
		// so the read settles first. Its own failure is not the scan's.
		await pending?.catch(() => {});
	}

	signal?.throwIfAborted();
	const matchedPages: MatchedSnapshotPage[] = [];
	for (let i = 0; i < matchedHashes.length; i += SQLITE_IN_CHUNK) {
		const rows = await candidates()
			.whereIn('phr.hash', matchedHashes.slice(i, i + SQLITE_IN_CHUNK))
			.select<{ pageId: number; hash: Uint8Array }[]>(
				'phr.page_id as pageId',
				'phr.hash as hash',
			);
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
