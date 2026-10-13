import type { ClusterReason } from './build-cluster-reason.js';
import type { BlockingReason } from './derive-blocking-reason.js';
import type { ClusteredPage } from './find-cross-cluster-duplicates.js';
import type { CrossBlockUnit, FinalGroupMembers } from './merge-cross-block-clusters.js';
import type { Pass0PageSignals, ResolveBlockKeysOptions } from './pass0-blocking.js';
import type { ContentRoot, LandmarkInstanceTokens } from './types.js';
import type { ClusterPartitionReport } from './validate-cluster-partition.js';
import type {
	StageAOutput,
	StageAPage,
	StageAUnit,
	TemplateStageARun,
} from '@nitpicker/core/types';

import { createTemplateStageARun } from '@nitpicker/core/create-template-stage-a-run';
import { TEMPLATE_BLOCK_SAMPLE_SIZE } from '@nitpicker/core/template-block-sample-size';

import { ALL_LANDMARK_TYPES } from './all-landmark-types.js';
import { buildClusterReason } from './build-cluster-reason.js';
import { filterFirstPartyStylesheetHrefs } from './filter-first-party-stylesheet-hrefs.js';
import { mergeCrossBlockClusters } from './merge-cross-block-clusters.js';
import { mergeValidatedClusters } from './merge-validated-clusters.js';
import { groupIndicesByBlockKey, resolveBlockKeys } from './pass0-blocking.js';
import { validateClusterPartition } from './validate-cluster-partition.js';

/**
 * Resolves block keys for a clustering pass, deriving each block key's
 * `BlockingReason` in the same call (via `resolveBlockKeys`'s
 * `includeReasons: true` overload) whenever a caller wants `ClusterReason`s.
 * @param blockingPages
 * @param options
 * @param needReasons
 */
function resolveBlockKeysForClustering(
	blockingPages: readonly Pass0PageSignals[],
	options: ResolvePageClusterKeysOptions | undefined,
	needReasons: boolean,
): {
	blockKeys: string[];
	reasonsByBlockKey: ReadonlyMap<string, BlockingReason> | undefined;
} {
	if (!needReasons) {
		return {
			blockKeys: resolveBlockKeys(blockingPages, options),
			reasonsByBlockKey: undefined,
		};
	}
	const result = resolveBlockKeys(blockingPages, { ...options, includeReasons: true });
	return { blockKeys: result.blockKeys, reasonsByBlockKey: result.reasonsByBlockKey };
}

/**
 * Runs {@link ./validate-cluster-partition.js | validateClusterPartition}
 * over Stage B's finished grouping and applies the built-in auto-merge
 * policy (see `onPartitionReport`'s own JSDoc) directly to `finalKeys`,
 * mutating it in place.
 *
 * No-ops (returning `rootByKey`/`finalGroupsByRoot` unchanged) when
 * `onPartitionReport` is `undefined`, mirroring `emitClusterReasons`'s own
 * gate for `onClusterReason`.
 *
 * When a merge is applied, `rootByKey` and `finalGroupsByRoot` are folded
 * according to the same rename so `emitClusterReasons` (called with this
 * function's return value, not the pre-merge originals) builds each
 * survivor's `ClusterReason` from its *actual* post-merge membership —
 * without this, a merged-away key's members would report `finalKeys[i]`
 * pointing at the survivor while its own stale `ClusterReason.memberCount`
 * still reflected only its pre-merge share.
 * @param finalKeys Every page's current final cluster key, in input order.
 *   Mutated in place when a merge is applied.
 * @param rootByKey Stage B's own result (see
 *   {@link ./merge-cross-block-clusters.js | MergeCrossBlockClustersResult}).
 * @param finalGroupsByRoot Stage B's own result.
 * @param getPageSignals Given an original page index, returns that page's
 *   `paths`/`stylesheetHrefs` — `undefined` for an index the caller has no
 *   record of (defensive; should not occur for indices Stage A/B actually
 *   retained).
 * @param onPartitionReport
 */
function validateAndMergePartition(
	finalKeys: string[],
	rootByKey: ReadonlyMap<string, string>,
	finalGroupsByRoot: ReadonlyMap<string, FinalGroupMembers>,
	getPageSignals: (
		pageIndex: number,
	) => { paths: readonly string[]; stylesheetHrefs: readonly string[] } | undefined,
	onPartitionReport: ((report: ClusterPartitionReport) => void) | undefined,
): {
	rootByKey: ReadonlyMap<string, string>;
	finalGroupsByRoot: ReadonlyMap<string, FinalGroupMembers>;
} {
	if (!onPartitionReport) return { rootByKey, finalGroupsByRoot };

	const clusteredPages: ClusteredPage[] = [];
	for (const [finalKey, group] of finalGroupsByRoot) {
		for (const [i, tokens] of group.tokenSets.entries()) {
			const pageIndex = group.pageIndices[i] ?? -1;
			if (pageIndex === -1) continue;
			const signals = getPageSignals(pageIndex);
			if (!signals) continue;
			clusteredPages.push({
				clusterKey: finalKey,
				tokens,
				paths: signals.paths,
				stylesheetHrefs: signals.stylesheetHrefs,
			});
		}
	}

	const report = validateClusterPartition(clusteredPages);
	onPartitionReport(report);

	// `findCrossClusterDuplicates` only ever returns entries that already
	// satisfy this condition (its exact-match pass sets `similarity: 1`
	// unconditionally; its near-match pass requires `corroboratedByMirrorAxis`
	// to accept a pair at all) — this filter is a defensive invariant check,
	// not something that currently narrows the result, kept so this call site
	// keeps working correctly if that policy ever loosens.
	const safeToMerge = report.crossClusterDuplicates.filter(
		(d) => d.similarity === 1 || d.corroboratedByMirrorAxis,
	);
	if (safeToMerge.length === 0) return { rootByKey, finalGroupsByRoot };

	const mergedKeys = mergeValidatedClusters(finalKeys, safeToMerge);
	const renameMap = new Map<string, string>();
	for (const [i, mergedKey] of mergedKeys.entries()) {
		if (finalKeys[i] !== mergedKey) renameMap.set(finalKeys[i]!, mergedKey);
		finalKeys[i] = mergedKey;
	}

	const mergedFinalGroupsByRoot = new Map<string, FinalGroupMembers>();
	for (const [key, group] of finalGroupsByRoot) {
		const target = renameMap.get(key) ?? key;
		const existing = mergedFinalGroupsByRoot.get(target);
		mergedFinalGroupsByRoot.set(target, {
			tokenSets: [...(existing?.tokenSets ?? []), ...group.tokenSets],
			landmarkInstances: [
				...(existing?.landmarkInstances ?? []),
				...group.landmarkInstances,
			],
			pageIndices: [...(existing?.pageIndices ?? []), ...group.pageIndices],
		});
	}

	const mergedRootByKey = new Map<string, string>();
	for (const [unitKey, stageBRoot] of rootByKey) {
		mergedRootByKey.set(unitKey, renameMap.get(stageBRoot) ?? stageBRoot);
	}

	return { rootByKey: mergedRootByKey, finalGroupsByRoot: mergedFinalGroupsByRoot };
}

/**
 * Builds and emits one {@link ClusterReason} per final cluster via
 * `onClusterReason`, from data Stage A/B already computed for clustering
 * itself: `crossBlockUnits` (Stage A's pre-merge units, each carrying its
 * originating block key), Stage B's `rootByKey`/`finalGroupsByRoot` and the
 * per-block-key `BlockingReason`s Pass 0 derived. No re-tokenization and no
 * extra corpus pass — this only re-groups references the driver already held.
 *
 * Sibling units of a block are the units carrying its key, in the order
 * Stage A produced them.
 *
 * No-ops when `reasonsByBlockKey` or `onClusterReason` is `undefined`.
 * @param crossBlockUnits
 * @param rootByKey
 * @param finalGroupsByRoot
 * @param reasonsByBlockKey
 * @param onClusterReason
 */
function emitClusterReasons(
	crossBlockUnits: readonly CrossBlockUnit[],
	rootByKey: ReadonlyMap<string, string>,
	finalGroupsByRoot: ReadonlyMap<string, FinalGroupMembers>,
	reasonsByBlockKey: ReadonlyMap<string, BlockingReason> | undefined,
	onClusterReason: ((clusterKey: string, reason: ClusterReason) => void) | undefined,
): void {
	if (!onClusterReason || !reasonsByBlockKey) return;

	const siblingUnitKeysByBlock = new Map<string, string[]>();
	for (const unit of crossBlockUnits) {
		const blockKey = unit.blockKey ?? '';
		const siblings = siblingUnitKeysByBlock.get(blockKey);
		if (siblings) {
			siblings.push(unit.key);
		} else {
			siblingUnitKeysByBlock.set(blockKey, [unit.key]);
		}
	}

	const unitKeysByRoot = new Map<string, string[]>();
	for (const unit of crossBlockUnits) {
		const root = rootByKey.get(unit.key) ?? unit.key;
		const list = unitKeysByRoot.get(root);
		if (list) {
			list.push(unit.key);
		} else {
			unitKeysByRoot.set(root, [unit.key]);
		}
	}

	for (const [rootKey, unitKeys] of unitKeysByRoot) {
		const finalGroup = finalGroupsByRoot.get(rootKey);
		if (!finalGroup) continue;

		const seenBlockKeys = new Set<string>();
		const blocking: { blockKey: string; reason: BlockingReason }[] = [];
		const siblingRoots = new Set<string>();
		for (const unitKey of unitKeys) {
			const blockKey = JSON.parse(unitKey)[0] as string;
			if (!seenBlockKeys.has(blockKey)) {
				seenBlockKeys.add(blockKey);
				const reason = reasonsByBlockKey.get(blockKey);
				if (reason) blocking.push({ blockKey, reason });
			}
			for (const siblingUnitKey of siblingUnitKeysByBlock.get(blockKey) ?? []) {
				const siblingRoot = rootByKey.get(siblingUnitKey) ?? siblingUnitKey;
				if (siblingRoot !== rootKey) siblingRoots.add(siblingRoot);
			}
		}

		onClusterReason(
			rootKey,
			buildClusterReason({
				tokenSets: finalGroup.tokenSets,
				landmarkInstances: finalGroup.landmarkInstances,
				blocking,
				siblingClusterKeys: [...siblingRoots].toSorted(),
			}),
		);
	}
}

/**
 * Per-page input to {@link ./resolve-page-cluster-keys.js | resolvePageClusterKeys}:
 * the blocking signals {@link ./resolve-blocking-group-keys.js | resolveBlockingGroupKeys}
 * needs, plus the page's raw HTML.
 */
export type PageClusterSignals = {
	paths: readonly string[];
	stylesheetHrefs: readonly string[];
	html: string;
	/**
	 * This page's own URL host (hostname, optionally `:port` — same shape as
	 * `new URL(pageUrl).host`), forwarded to
	 * {@link ./filter-first-party-stylesheet-hrefs.js | filterFirstPartyStylesheetHrefs}
	 * so it can judge that page's `stylesheetHrefs` by direct comparison
	 * instead of inferring a batch-wide dominant host.
	 */
	host?: string;
	/**
	 * Identity of this page's content-root element, as a crawler detected it
	 * (see {@link ./types.js | ContentRoot}). Anchors the per-block content
	 * depth cap on sites without `<main>`/`role="main"`, whose freeform
	 * content would otherwise dominate the comparison; without it the cap
	 * falls back to `<main>`/`role="main"` and then the built-in `#main`,
	 * `#content`, … list. HTML-dependent, so — unlike `host` — it takes no
	 * part in Pass 0 blocking and is read from the page only when the HTML is.
	 */
	contentRoot?: ContentRoot;
};

/**
 * Progress event emitted by `resolvePageClusterKeys` when an `onProgress`
 * callback is provided — nitpicker's `classifyPageTemplates` forwards it
 * (typed as `TemplateClusteringProgress`) to the CLI's `TaskList` row.
 *
 * The event is a discriminated union on `phase`:
 * - `pass0-signals`: reading blocking signals (paths / stylesheetHrefs /
 *   host) from the factory. Fires every 1,000 pages during Pass 0.
 * - `pass1-block-complete`: one block's Stage A finished; carries the
 *   block's key and a running count of completed blocks.
 * - `pass1b-assign`: streaming path only. Assignment of the pages outside
 *   the block samples is in progress. Fires every 1,000 pages of Pass 1b.
 * - `stage-b-start`: cross-block merge has begun. Fires once per call.
 *
 * Stage B emits no per-round events.
 */
export type ProgressEvent =
	| { readonly phase: 'pass0-signals'; readonly pagesSeen: number }
	| {
			readonly phase: 'pass1-block-complete';
			readonly blockKey: string;
			readonly blocksProcessed: number;
			readonly totalBlocks: number;
	  }
	| {
			readonly phase: 'pass1b-assign';
			readonly pagesAssigned: number;
			readonly pagesToAssign: number;
	  }
	| { readonly phase: 'stage-b-start'; readonly unitCount: number };

/**
 * Pass 0's blocking options plus observability hooks. Stage A takes no
 * options: it runs with the fixed configuration the stored keys were
 * computed with (landmarks excluded, hash-like class names filtered, the
 * content depth swept over 2, 3, 4, 5, 6, 8 and 10 for a 1.5× knee, a 0.8
 * similarity bound).
 * @see resolvePageClusterKeys
 */
export type ResolvePageClusterKeysOptions = ResolveBlockKeysOptions & {
	/**
	 * Optional observability hook — invoked at every progress event
	 * documented on {@link ./resolve-page-cluster-keys.js | ProgressEvent}.
	 * Independent of `onClusterReason`.
	 */
	onProgress?: (event: ProgressEvent) => void;
	/**
	 * Optional observability hook invoked once per **final cluster** (not
	 * per page) with that cluster's {@link ClusterReason} — the blocking
	 * signal that grouped it, its DOM-structural token core, its
	 * per-landmark-type commonality, and the sibling cluster keys it was
	 * split from within the same Pass-0 block. A `ClusterReason` is sized by
	 * cluster count, not page count, so it carries no memory risk on the
	 * streaming path.
	 *
	 * Building the reasons re-uses Stage A/B's own intermediate state (the
	 * quorum core, the per-unit landmark instances, the blocking evidence) —
	 * it does not re-tokenize pages. Omitting `onClusterReason` skips that
	 * bookkeeping entirely.
	 * @example
	 * ```ts
	 * const reasons = new Map<string, ClusterReason>();
	 * const keys = await resolvePageClusterKeys(pages, {
	 *   onClusterReason: (key, reason) => reasons.set(key, reason),
	 * });
	 * ```
	 */
	onClusterReason?: (clusterKey: string, reason: ClusterReason) => void;
	/**
	 * Optional observability hook invoked once per run with a
	 * {@link ClusterPartitionReport} — evidence that Stage A/B's finished
	 * partition may need correcting, from
	 * {@link ./validate-cluster-partition.js | validateClusterPartition}.
	 *
	 * Setting this option does two things, both gated on its presence the
	 * same way `onClusterReason` gates its own bookkeeping (callers that omit
	 * it pay nothing and see no behavior change):
	 *
	 * 1. Computes the report from Stage B's finished grouping (no
	 *    re-tokenization — reuses the token sets Stage A/B already hold).
	 * 2. Applies a fixed, built-in auto-merge policy to the *actual*
	 *    returned cluster keys before this callback (and
	 *    `onClusterReason`) ever sees them: every
	 *    `report.crossClusterDuplicates` entry with `similarity === 1` or
	 *    `corroboratedByMirrorAxis: true` is merged via
	 *    {@link ./merge-validated-clusters.js | mergeValidatedClusters}.
	 *    This is the one part of this library where an option changes the
	 *    returned `clusterKey`s themselves, not just side-channel
	 *    metadata — a caller who wants a *different* merge policy (or
	 *    none at all) should omit this option and call
	 *    `validateClusterPartition`/`findCrossClusterDuplicates`/
	 *    `mergeValidatedClusters` directly on this function's own output.
	 *
	 * On the streaming path (`pageCount > CORPUS_INLINE_THRESHOLD`), the
	 * report is built only from pages Stage A/B actually retained token
	 * sets for — the block samples, not pages assigned in Pass 1b — the same
	 * sampling trade-off Stage B itself already makes for corpora too large
	 * to hold in full. Any merge the sampled evidence justifies is still
	 * applied to every page sharing the merged keys, sampled or not.
	 * @example
	 * ```ts
	 * const keys = await resolvePageClusterKeys(pages, {
	 *   onPartitionReport: (report) => {
	 *     for (const c of report.cohesion) if (c.suspicious) console.warn(c);
	 *   },
	 * });
	 * ```
	 */
	onPartitionReport?: (report: ClusterPartitionReport) => void;
};

/**
 * Corpus size at or below which every page is kept until its block is
 * clustered and landmark chrome is judged across the whole corpus. Above it
 * the streaming path keeps a sample per block, judges chrome per sampled
 * block, and assigns every other page to the nearest sampled cluster in a
 * second read.
 *
 * The in-memory path holds every page until its block is clustered, which a
 * ~176,000-page crawl could not afford; the corpora the classifier was
 * validated on (302, 1,416, 8,936 and 89 pages — 9 / 21 / 63 / 3 clusters)
 * sit well below 20,000, with room for sites twice the largest. Changing it
 * moves corpora between the two paths, and so changes their stored keys.
 * `scripts/bench-template-classification.mjs` measures time and peak memory
 * on either path.
 */
export const CORPUS_INLINE_THRESHOLD = 20_000;

/**
 * Pages per block the streaming path clusters (the native Stage A's own
 * sample size, read from the addon). Stage B then works on units of at most
 * this many members, and caps merged groups at it too, so its cost stays
 * bounded across rounds whatever the corpus size.
 *
 * ## Semantic differences from the in-memory path
 *
 * - **Chrome discovery is sample-based per block.** Only landmark
 *   signatures on ≥ 2 sample members and below the sample-derived auto-cut
 *   are local chrome; the in-memory path judges them across the corpus.
 * - **Non-sample pages are assigned by max-Jaccard against sample member
 *   token sets.** A page whose closest sample member is genuinely dissimilar
 *   still gets slotted into the least-bad cluster; a pragmatic trade for a
 *   bounded assignment cost (no unbounded "outlier" cluster growth).
 * - **Stage B sees the sampled units only.** Non-sample pages carry the
 *   final key Stage B produces for their assigned cluster, without
 *   contributing to Stage B's own frequency computations.
 */
export const BLOCK_SAMPLE_SIZE: number = TEMPLATE_BLOCK_SAMPLE_SIZE;

/**
 * Factory function returning an iterator over pages. Called once per pass —
 * the driver reads the corpus two or three times (blocking signals, then
 * HTML, and on the streaming path HTML again for assignment). Callers with a
 * materialized array can wrap it as `() => pagesArray[Symbol.iterator]()`,
 * or use {@link ./resolve-page-cluster-keys.js | resolvePageClusterKeysFromArray}.
 *
 * ## Why a factory rather than an `AsyncIterable`
 *
 * An `AsyncIterable` returned once cannot be traversed a second time. A
 * factory lets the caller build a fresh iterator each pass (typically by
 * re-issuing an archive query), so the driver never holds the corpus's HTML
 * at once. Every pass must yield the same pages in the same order.
 */
export type PageFactory = () =>
	| Iterable<PageClusterSignals>
	| AsyncIterable<PageClusterSignals>;

/**
 * Pages handed to the native run per call: enough to keep its thread pool
 * busy on one call, few enough that the next batch is read while it runs.
 * Only throughput depends on it, never the keys.
 */
const PAGES_PER_BATCH = 64;

/**
 * HTML (in UTF-16 code units) handed to the native run per call, at most, so
 * a batch of unusually large pages does not hold their copies all at once.
 * Only memory and throughput depend on it, never the keys.
 */
const HTML_PER_BATCH = 32 * 1024 * 1024;

/**
 * The error for a factory that yields a different corpus on a later read.
 * @param pagesRead
 * @param expected
 */
function factoryMismatch(pagesRead: number, expected: number): Error {
	return new Error(
		`resolvePageClusterKeys: a read of the page factory produced ${pagesRead} pages but Pass 0 saw ${expected} — the factory must produce the same pages in the same order on every call`,
	);
}

/**
 * Reads `pages` once and hands them to `push` in batches, the pages `mask`
 * leaves out with empty HTML (the run does not read them, so their HTML is
 * not copied to it). A batch is read while the previous one is processed
 * (the native run works off Node's main thread); each push is awaited
 * before the next one starts, as the run requires.
 *
 * Only the page count is checked against Pass 0: a factory yielding as many
 * pages but different ones, or in another order, goes unnoticed.
 * @param pages
 * @param mask The run's `pageMask()` for this read; its length is the page
 *   count Pass 0 saw.
 * @param push
 */
async function streamPages(
	pages: PageFactory,
	mask: Uint8Array,
	push: (batch: StageAPage[]) => Promise<void>,
): Promise<void> {
	let inFlight: Promise<void> = Promise.resolve();
	let batch: StageAPage[] = [];
	let batchLength = 0;
	let pagesRead = 0;
	const flush = async () => {
		await inFlight;
		inFlight = push(batch);
		// Read on while it runs; a rejection surfaces at the next `await`
		// (this handler only keeps it from counting as unhandled meanwhile).
		inFlight.catch(() => {});
		batch = [];
		batchLength = 0;
	};
	try {
		for await (const page of pages()) {
			if (pagesRead >= mask.length) {
				throw factoryMismatch(pagesRead + 1, mask.length);
			}
			const html = mask[pagesRead] ? page.html : '';
			pagesRead++;
			batch.push({
				html,
				...(page.contentRoot ? { contentRoot: page.contentRoot } : {}),
			});
			batchLength += html.length;
			if (batch.length >= PAGES_PER_BATCH || batchLength >= HTML_PER_BATCH) {
				await flush();
			}
		}
	} catch (error) {
		// Let the running call settle before the caller cancels the run, so
		// nothing is left working on a run that is being given up.
		await inFlight.catch(() => {});
		throw error;
	}
	if (batch.length > 0) {
		await flush();
	}
	await inFlight;
	if (pagesRead !== mask.length) {
		throw factoryMismatch(pagesRead, mask.length);
	}
}

/**
 * Turns the native run's flat unit into the {@link CrossBlockUnit} Stage B
 * takes.
 * @param unit
 * @param output
 * @param blockKeys
 */
function toCrossBlockUnit(
	unit: StageAUnit,
	output: StageAOutput,
	blockKeys: readonly string[],
): CrossBlockUnit {
	const tokensOf = (ids: Uint32Array, from: number, to: number) => {
		const tokens = new Set<string>();
		for (let index = from; index < to; index++) {
			tokens.add(output.tokens[ids[index]!]!);
		}
		return tokens;
	};
	const memberCount = unit.memberPageIndices.length;
	const memberTokenSets: ReadonlySet<string>[] = [];
	const memberLandmarkInstances: LandmarkInstanceTokens[][] = [];
	for (let member = 0; member < memberCount; member++) {
		memberTokenSets.push(
			tokensOf(
				unit.memberTokens,
				unit.memberTokenOffsets[member]!,
				unit.memberTokenOffsets[member + 1]!,
			),
		);
		const instances: LandmarkInstanceTokens[] = [];
		for (
			let instance = unit.memberInstanceOffsets[member]!;
			instance < unit.memberInstanceOffsets[member + 1]!;
			instance++
		) {
			instances.push({
				type: ALL_LANDMARK_TYPES[unit.instanceTypes[instance]!]!,
				tokens: tokensOf(
					unit.instanceTokens,
					unit.instanceTokenOffsets[instance]!,
					unit.instanceTokenOffsets[instance + 1]!,
				),
			});
		}
		memberLandmarkInstances.push(instances);
	}
	return {
		key: output.keys[unit.key]!,
		blockKey: blockKeys[unit.block]!,
		memberTokenSets,
		memberLandmarkInstances,
		memberPageIndices: [...unit.memberPageIndices],
	};
}

/**
 * Runs Stage A (and, streaming, the assignment of pages outside the
 * samples) in the native addon over the corpus `pages` yields.
 * @param pages
 * @param blockKeys Every page's Pass-0 block key, in corpus order.
 * @param streaming
 * @param onProgress
 */
async function runStageA(
	pages: PageFactory,
	blockKeys: readonly string[],
	streaming: boolean,
	onProgress: ((event: ProgressEvent) => void) | undefined,
): Promise<{ output: StageAOutput; blockKeyList: readonly string[] }> {
	const indicesByBlockKey = groupIndicesByBlockKey(blockKeys);
	const blockKeyList = [...indicesByBlockKey.keys()];
	const blockIndexByKey = new Map(blockKeyList.map((key, index) => [key, index]));
	const blockOfPage = Uint32Array.from(blockKeys, (key) => blockIndexByKey.get(key)!);

	const run: TemplateStageARun = createTemplateStageARun({
		blockKeys: blockKeyList,
		blockOfPage,
		streaming,
		...(onProgress ? { onProgress } : {}),
	});
	try {
		await streamPages(pages, run.pageMask(), (batch) => run.pushPages(batch));
		await run.finishPages();
		if (run.needsAssignment()) {
			await streamPages(pages, run.pageMask(), (batch) => run.pushAssignmentPages(batch));
		}
		return { output: await run.takeOutput(), blockKeyList };
	} catch (error) {
		run.cancel();
		throw error;
	}
}

/**
 * Clusters pages into templates by DOM structure.
 *
 * - **Pass 0** reads the blocking signals (paths, stylesheets, host) — no
 *   HTML — and splits the corpus into blocks (`resolveBlockKeys`).
 * - **Stage A** clusters each block in the native addon
 *   (`@nitpicker/core`'s `createTemplateStageARun`): landmark chrome is cut
 *   out, the content depth is capped at the block's knee, and complete-
 *   linkage clustering with a max-gap cut splits the block.
 * - **Stage B** merges clusters across blocks (`mergeCrossBlockClusters`),
 *   then the optional partition check and cluster reasons run.
 *
 * At or below {@link CORPUS_INLINE_THRESHOLD} pages, every page is clustered
 * and chrome is judged across the corpus. Above it — the streaming path —
 * each block is clustered on a sample of {@link BLOCK_SAMPLE_SIZE} pages and
 * a further read assigns the rest; see that constant for the semantic
 * differences. The factory is read twice — once for Pass 0's signals, once
 * for the HTML — and on the streaming path a third time to assign the pages
 * outside the samples; JavaScript never holds the whole corpus's HTML.
 * @param pages
 * @param options
 * @example
 * ```ts
 * // JSONL file source — factory can be re-invoked to re-open the file.
 * import { createReadStream } from 'node:fs';
 * import readline from 'node:readline';
 *
 * const keys = await resolvePageClusterKeys(() => {
 *   const lines = readline.createInterface({ input: createReadStream('pages.jsonl') });
 *   return (async function* () {
 *     for await (const line of lines) yield JSON.parse(line);
 *   })();
 * });
 * ```
 */
export async function resolvePageClusterKeys(
	pages: PageFactory,
	options?: ResolvePageClusterKeysOptions,
): Promise<string[]> {
	const onProgress = options?.onProgress;
	const blockingSignals: Pass0PageSignals[] = [];
	for await (const page of pages()) {
		if (onProgress && blockingSignals.length > 0 && blockingSignals.length % 1000 === 0) {
			onProgress({ phase: 'pass0-signals', pagesSeen: blockingSignals.length });
		}
		blockingSignals.push({
			paths: page.paths,
			stylesheetHrefs: page.stylesheetHrefs,
			host: page.host,
		});
	}
	if (blockingSignals.length === 0) return [];
	const streaming = blockingSignals.length > CORPUS_INLINE_THRESHOLD;

	const restrictStylesheetsToFirstParty =
		options?.restrictStylesheetsToFirstParty ?? true;
	const blockingPages = restrictStylesheetsToFirstParty
		? filterFirstPartyStylesheetHrefs(blockingSignals)
		: blockingSignals;
	const onClusterReason = options?.onClusterReason;
	const { blockKeys, reasonsByBlockKey } = resolveBlockKeysForClustering(
		blockingPages,
		options,
		onClusterReason !== undefined,
	);

	const { output, blockKeyList } = await runStageA(
		pages,
		blockKeys,
		streaming,
		onProgress,
	);
	const finalKeys = Array.from(output.keyOfPage, (keyIndex) => output.keys[keyIndex]!);
	const crossBlockUnits = output.units.map((unit) =>
		toCrossBlockUnit(unit, output, blockKeyList),
	);

	onProgress?.({ phase: 'stage-b-start', unitCount: crossBlockUnits.length });
	const { rootByKey, finalGroupsByRoot } = mergeCrossBlockClusters(
		crossBlockUnits,
		streaming ? { capMembers: BLOCK_SAMPLE_SIZE } : undefined,
	);
	for (let i = 0; i < finalKeys.length; i++) {
		const currentKey = finalKeys[i]!;
		const rootKey = rootByKey.get(currentKey);
		if (rootKey !== undefined && rootKey !== currentKey) {
			finalKeys[i] = rootKey;
		}
	}

	const validated = validateAndMergePartition(
		finalKeys,
		rootByKey,
		finalGroupsByRoot,
		(i) => blockingSignals[i],
		options?.onPartitionReport,
	);

	emitClusterReasons(
		crossBlockUnits,
		validated.rootByKey,
		validated.finalGroupsByRoot,
		reasonsByBlockKey,
		onClusterReason,
	);
	return finalKeys;
}

/**
 * Convenience wrapper that runs {@link ./resolve-page-cluster-keys.js | resolvePageClusterKeys}
 * on a materialized array.
 * @param pages
 * @param options
 * @example
 * ```ts
 * const keys = await resolvePageClusterKeysFromArray([
 *   { paths: ['news', '1'], stylesheetHrefs: [], html: '<body><article>one</article></body>' },
 *   { paths: ['news', '2'], stylesheetHrefs: [], html: '<body><article>two</article></body>' },
 *   { paths: ['about'], stylesheetHrefs: [], html: '<body><section>about</section></body>' },
 * ]);
 * ```
 */
export function resolvePageClusterKeysFromArray(
	pages: readonly PageClusterSignals[],
	options?: ResolvePageClusterKeysOptions,
): Promise<string[]> {
	return resolvePageClusterKeys(() => pages, options);
}
