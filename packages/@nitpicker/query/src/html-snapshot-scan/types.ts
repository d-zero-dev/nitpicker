import type { Knex } from 'knex';

/** URL filters narrowing the pages whose HTML snapshots are scanned. */
export interface HtmlSnapshotPageFilters {
	/** SQL LIKE pattern restricting the page URLs to scan. */
	readonly urlPattern?: string;
	/** Directory path prefix restricting the page URLs to scan. */
	readonly directory?: string;
}

/** One distinct stored HTML snapshot, decompressed. */
export interface HtmlSnapshot {
	/** Lowercase hex of the snapshot's SHA-256 hash; stable `Map` key. */
	readonly hash: string;
	/** The decompressed HTML. */
	readonly html: string;
}

/** Parameters of {@link import('./scan-html-snapshots.js').scanHtmlSnapshots}. */
export interface ScanHtmlSnapshotsParams {
	readonly knex: Knex;
	/** Page filters; omit to scan every in-scope page. */
	readonly filters?: HtmlSnapshotPageFilters;
	/**
	 * Judges one snapshot. Called once per distinct snapshot, however many
	 * pages share it; `true` marks every page of the snapshot as matched.
	 */
	readonly matches: (snapshot: HtmlSnapshot) => boolean;
	/** Receives `Scanning HTML snapshots: <done> / <total>` after each chunk. */
	readonly onProgress?: (message: string) => void;
}

/** A page whose snapshot matched. */
export interface MatchedSnapshotPage {
	readonly pageId: number;
	/** Lowercase hex hash of the matched snapshot ({@link HtmlSnapshot.hash}). */
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
