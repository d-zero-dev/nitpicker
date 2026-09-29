import type { Config } from '../types.js';

/**
 * Ordered phase sequence a single source's transfer announces via
 * `onPhase`, unconditionally and always in this order (mirrors
 * `ViewerReadModelBuildPhase`'s contract — no branch skips a phase, so a
 * caller can pre-build one `TaskList` row per phase and rely on them
 * settling in order).
 */
export type TransferPhase =
	| 'planningContentItems'
	| 'copyingDictionaries'
	| 'copyingContentItems'
	| 'copyingPageRows'
	| 'copyingResources'
	| 'copyingJournals'
	| 'committing'
	| 'flatteningRedirects'
	| 'reclassifyingResources'
	| 'countingExternalInScope';

/**
 * Progress callbacks a caller (the CLI's `concat`/`split` commands) passes
 * into {@link import('./concat-archives.js').concatArchives} /
 * {@link import('./split-archive.js').splitArchive} to drive a `TaskList`
 * display. `onPhase` fires once per phase per source (plus once per
 * whole-operation post phase); `onProgress` fires zero or more times while
 * a phase is active, with a phase-specific unit (rows copied, ids
 * classified, …).
 */
export interface TransferCallbacks {
	/** Called when a new source's extraction begins (0-based index). */
	readonly onSourceStart?: (sourceIndex: number, filePath: string) => void;
	/**
	 * Called whenever the active phase changes, for the source at
	 * `sourceIndex` (or after every source has finished, for the
	 * whole-operation post phases — `flatteningRedirects` /
	 * `reclassifyingResources` / `countingExternalInScope` — where
	 * `sourceIndex` is `sources.length`).
	 */
	readonly onPhase?: (sourceIndex: number, phase: TransferPhase) => void;
	/** Called zero or more times while a phase is active. */
	readonly onProgress?: (processed: number, total: number) => void;
}

/** Per-source outcome of {@link import('./transfer-archive-rows.js').transferArchiveRows}. */
export interface TransferSourceResult {
	/** Number of `content_items` rows copied as brand-new rows (no prior dest row for that URL). */
	readonly inserted: number;
	/**
	 * Number of existing dest `content_items` rows overwritten because this
	 * source's observation outranked the dest's (concat only; always `0`
	 * for split, which never merges into an existing archive).
	 */
	readonly replaced: number;
	/** Number of source rows skipped because dest already held an equal-or-better observation (concat only). */
	readonly skipped: number;
	/** Number of source rows kept as an external stub, not a full copy (split only; always `0` for concat). */
	readonly stubbed: number;
	/** Number of source rows dropped entirely — out of scope and unreferenced (split only; always `0` for concat). */
	readonly dropped: number;
}

/** Result of {@link import('./concat-archives.js').concatArchives}. */
export interface ConcatArchivesResult {
	/** The merged config written to the destination's `info` row. */
	readonly config: Config;
	/** Per-source transfer outcome, in argument order. */
	readonly sources: readonly TransferSourceResult[];
	/**
	 * Number of URLs that fall inside the merged scope but were never
	 * fetched as an internal page by any source (still `is_external = 1`
	 * in the output) — the count the CLI surfaces with a
	 * `crawl <out> --append <root>` hint, since concat never re-promotes
	 * external rows on its own (that would fabricate a `scraped = 1`
	 * observation with no body/meta behind it).
	 */
	readonly externalInScopeCount: number;
	/** Number of `inventory/<sha256>.txt` source lists copied (deduplicated by filename across sources). */
	readonly inventoryListsCopied: number;
}

/** Result of {@link import('./split-archive.js').splitArchive}. */
export interface SplitArchiveResult {
	/** The derived config (roots = the given scope URLs) written to the destination's `info` row. */
	readonly config: Config;
	/** The single source's transfer outcome. */
	readonly source: TransferSourceResult;
	/**
	 * Usually `0`, but not structurally guaranteed to be: the operator's
	 * scope URLs are not required to be a subset of the source's original
	 * roots, so a scope broader than (or merely different from) the
	 * original can bring an external-only (never crawled) page inside the
	 * new scope, the same way concat's own external-in-scope count can be
	 * non-zero.
	 */
	readonly externalInScopeCount: number;
	/** Number of `inventory/<sha256>.txt` source lists copied. */
	readonly inventoryListsCopied: number;
}

/**
 * Thrown by {@link import('./merge-archive-configs.js').mergeArchiveConfigs}
 * when two source archives disagree on a config field that concat cannot
 * silently reconcile (`disableQueries`, `fromList`) — see that function's
 * docs for why these two specifically cannot fall back to "first archive
 * wins" like every other scalar field.
 */
export class ArchiveConfigConflictError extends Error {
	/**
	 * @param field - The conflicting `Config` field name.
	 * @param values - The distinct values seen across sources, in argument order.
	 */
	constructor(
		public readonly field: string,
		public readonly values: readonly unknown[],
	) {
		super(
			`Cannot merge archives: "${field}" differs across sources (${values.map((v) => JSON.stringify(v)).join(' vs ')}). ` +
				'Re-crawl the sources with matching settings before concatenating them.',
		);
		this.name = 'ArchiveConfigConflictError';
	}
}

/**
 * Thrown when a dictionary-table copy's post-copy id map does not cover
 * every id it needed to map (a source row referencing a value that failed
 * to insert or resolve) — a defensive integrity check, since a silently
 * incomplete map would surface much later as a confusing "no such row" or
 * a dangling NULL FK deep in an unrelated read path.
 */
export class TransferIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransferIntegrityError';
	}
}
