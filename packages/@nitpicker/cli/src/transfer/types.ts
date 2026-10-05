/**
 * Everything `format-transfer-notices.ts`/`resolve-transfer-exit-code.ts`
 * need to know about a finished `concat`/`split` run — gathered by
 * `commands/concat.ts`/`commands/split.ts` from the crawler-side result
 * plus their own bookkeeping (pending check, plugin-data listing,
 * read-model build outcome), and printed/exit-coded only AFTER the
 * `TaskList` has fully settled (never while a row is still active — see
 * those commands' own docs for why).
 */
export interface TransferOutcome {
	/** The output archive's absolute path, for the `crawl`/`analyze`/`viewer-build` hint commands. */
	readonly outputPath: string;
	/** `true` when the output's `roots` came from a `fromList` archive (split always rejects these, so this is concat-only). */
	readonly fromList: boolean;
	/** The output's first root, for the `--append <root>` hint text. */
	readonly appendHintRoot: string;
	/**
	 * URLs inside the output's scope that remain external (never
	 * promoted — see `ConcatArchivesResult.externalInScopeCount`'s docs).
	 * Usually `0` for split too, but not structurally guaranteed — see
	 * `SplitArchiveResult.externalInScopeCount`'s docs for why a split
	 * scope broader than the source's original roots can produce a
	 * non-zero count.
	 */
	readonly externalInScopeCount: number;
	/** `getCrawlingState().pending.length` on the finished output archive. */
	readonly pendingCount: number;
	/** Plugin-data directory names dropped from any source, deduplicated. */
	readonly pluginDataEntries: readonly string[];
	/** The viewer read-model build's failure message, or `null` if it succeeded. */
	readonly readModelError: string | null;
	/**
	 * The page template classification's failure message, or `null` if it
	 * succeeded (or was skipped with `--skip-templates`).
	 */
	readonly templateClassificationError: string | null;
}
