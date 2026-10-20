import type { Knex } from 'knex';

/** URL filters narrowing the pages whose HTML snapshots are scanned. */
export interface HtmlSnapshotPageFilters {
	/** SQL LIKE pattern restricting the page URLs to scan. */
	readonly urlPattern?: string;
	/** Directory the scanned pages must be in or under; see `applyUrlDirectoryFilter`. */
	readonly directory?: string;
}

/** One distinct stored HTML snapshot as it sits in `page_html_blobs`, not yet decoded. */
export interface StoredSnapshotBlob {
	/** Lowercase hex of the snapshot's SHA-256 hash; the key a judge keeps results under. */
	readonly hash: string;
	/** The stored bytes. */
	readonly body: Uint8Array;
	/** `page_html_blobs.codec`: `zstd` or `none`. */
	readonly codec: string;
}

/** Parameters of {@link import('./scan-html-snapshots.js').scanHtmlSnapshots}. */
export interface ScanHtmlSnapshotsParams {
	readonly knex: Knex;
	/** Page filters; omit to scan every in-scope page. */
	readonly filters?: HtmlSnapshotPageFilters;
	/** Receives `Scanning HTML snapshots: <done> / <total>` after each chunk. */
	readonly onProgress?: (message: string) => void;
	/**
	 * Judges a batch of distinct snapshots as stored and resolves with one
	 * verdict per snapshot, in order; `true` marks every page of the snapshot
	 * as matched. A batch is closed when its estimated decoded size reaches
	 * `SCAN_BATCH_BYTES`, so a judge holds a bounded amount at a time.
	 */
	readonly judgeBatch: (
		batch: readonly StoredSnapshotBlob[],
	) => Promise<readonly boolean[]>;
}

/** A page whose snapshot matched. */
export interface MatchedSnapshotPage {
	readonly pageId: number;
	/** Lowercase hex hash of the matched snapshot ({@link StoredSnapshotBlob.hash}). */
	readonly hash: string;
}

/** Result of {@link import('./scan-html-snapshots.js').scanHtmlSnapshots}. */
export interface ScanHtmlSnapshotsResult {
	/** Matched pages in ascending page-id order. */
	readonly matchedPages: readonly MatchedSnapshotPage[];
	/** Number of distinct snapshots judged as matching. */
	readonly matchedSnapshots: number;
	/**
	 * Number of distinct snapshot hashes walked. Each one is decompressed and
	 * judged: `page_html_ref.hash` is a foreign key to `page_html_blobs`, so
	 * every walked hash has a blob.
	 */
	readonly scannedSnapshots: number;
	/** Number of in-scope pages that have a stored HTML snapshot. */
	readonly candidatePages: number;
}
