#!/usr/bin/env node
/**
 * Baseline: crawl-end template classification (the page-cluster engine).
 *
 * Cases:
 *
 * - `full`: `classifyArchivePageTemplates` exactly as crawl / viewer-build
 *   run it, including the write. This is the number to compare across
 *   implementations. `phasesMs` splits the wall clock at the progress
 *   events the engine emits: `loadingPages` (page handles), `untilStageB`
 *   (stylesheet references, HTML reads, landmarks, blocking, Stage A of
 *   every block, and on the streaming path Pass 1b), `stageB` (cross-block
 *   merge, partition validation, cluster reasons) and `writing`.
 *   `slowestBlockMs` is the longest gap between two consecutive blocks
 *   finishing.
 * - `breakdown`: an analysis run (`metrics.analysisOnly`) that re-drives
 *   the engine's exported stages block by block to split their cost:
 *   the content-depth sweep (`detectContentDepthCap`), tokenize (cap + both
 *   tokenize passes), the rest of Stage A (`stageAOwn`: comparison sets,
 *   dendrogram, cut, containment — `stageAPerBlock`'s time minus the first
 *   two, which it repeats internally), Pass 1b's tokenize of the pages left
 *   out of a block's sample (`assignTokenize`, streaming path only; the
 *   Jaccard assignment itself is not repeated) and Stage B
 *   (`mergeCrossBlockClusters` only). Per block it counts the pages `n`,
 *   the pages Stage A ran on, and `u`, the distinct token sets among them
 *   (`countDistinctTokenSets`). It runs about twice the engine's work, so
 *   its `timeMs` is not the classification time.
 *
 *   It follows the engine's two paths: up to the engine's in-memory
 *   threshold Stage A runs on whole blocks; above it on the same reservoir
 *   sample the streaming path draws (`selectStageASample`), with Stage B
 *   units capped at the sample size. One deliberate difference keeps its
 *   memory bounded to one block's HTML: chrome landmarks are discovered per
 *   block (the streaming path's semantics), where the in-memory path pools
 *   them corpus-wide.
 *
 *   It imports engine internals (`pass0-blocking`, `extractLandmarks`,
 *   `computeLocalLandmarkTokens`, `detectContentDepthCap`, `capContentDepth`,
 *   `tokenize`, `resolveRecurringClasses`, `stageAPerBlock`,
 *   `mergeCrossBlockClusters`, the threshold and sample-size constants) and
 *   mirrors how `resolve-page-cluster-keys.ts` and `stage-a-per-block.ts`
 *   chain them. A change to those signatures or to that chaining must be
 *   followed here. `yarn bench:smoke` catches a broken import or a broken
 *   call on the in-memory path only: its 2-page fixture never reaches the
 *   streaming branch (sampling, Pass 1b, capped Stage B), whose page
 *   selection is pinned by `select-stage-a-sample.spec.mjs` instead. When
 *   the engine moves to Rust (#426) and the internals are gone, delete this
 *   case: `full` keeps measuring the same operation in the same format.
 *
 * Both run on a throwaway extracted copy; the source archive is never
 * modified. Block keys are never printed: they carry the crawled site's
 * paths and hosts.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-template-classification.mjs <archive.nitpicker> [--case full|breakdown] [--json]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { classifyArchivePageTemplates } from '@nitpicker/archive/template-classification/classify-archive-page-templates';

import { collectPageStylesheetUrls } from '../packages/@nitpicker/archive/lib/template-classification/collect-page-stylesheet-urls.js';
import { createContentRootHint } from '../packages/@nitpicker/archive/lib/template-classification/create-content-root-hint.js';
import { capContentDepth } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/cap-content-depth.js';
import { MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/derive-comparison-sets.js';
import { detectContentDepthCap } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/detect-content-depth-cap.js';
import { extractLandmarks } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/extract-landmarks.js';
import { filterFirstPartyStylesheetHrefs } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/filter-first-party-stylesheet-hrefs.js';
import { mergeCrossBlockClusters } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/merge-cross-block-clusters.js';
import {
	groupIndicesByBlockKey,
	resolveBlockKeys,
} from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/pass0-blocking.js';
import {
	BLOCK_SAMPLE_SIZE,
	CORPUS_INLINE_THRESHOLD,
	computeLocalLandmarkTokens,
} from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/resolve-page-cluster-keys.js';
import { resolveRecurringClasses } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/resolve-recurring-classes.js';
import { stageAPerBlock } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/stage-a-per-block.js';
import { tokenize } from '../packages/@nitpicker/archive/lib/template-classification/page-cluster/tokenize.js';

import { countDistinctTokenSets } from './bench-lib/count-distinct-token-sets.mjs';
import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { measureSyncMs } from './bench-lib/measure-sync-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { selectStageASample } from './bench-lib/select-stage-a-sample.mjs';
import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';

/** Page handles loaded per batch — the value `classifyArchivePageTemplates` uses. */
const PAGE_BATCH_SIZE = 100_000;

/** Largest blocks listed individually in the `breakdown` result. */
const LISTED_BLOCKS = 10;

const { archive, caseName, json } = readBenchArguments('template-classification');

/**
 * Runs the production classification and splits it at its progress events.
 * @param {import('@nitpicker/archive/archive').default} writable - The throwaway copy.
 * @returns {Promise<{ timeMs: number; metrics: Record<string, unknown> }>} The measurement.
 */
async function runFull(writable) {
	const marks = new Map();
	let totalBlocks = 0;
	let lastBlockAt = null;
	let slowestBlockMs = 0;
	const { ms, value: result } = await measureMs(() =>
		classifyArchivePageTemplates(writable, {
			onProgress: (event) => {
				const now = performance.now();
				if (!marks.has(event.phase)) {
					marks.set(event.phase, now);
				}
				if (event.phase === 'pass1-block-complete') {
					totalBlocks = event.totalBlocks;
					// The first block's gap would include everything before it.
					if (lastBlockAt !== null) {
						slowestBlockMs = Math.max(slowestBlockMs, now - lastBlockAt);
					}
					lastBlockAt = now;
				}
			},
		}),
	);
	const end = performance.now();
	// A phase whose event never fired (no page classified: the engine returns
	// before Stage B and nothing is written) is reported as null, not 0.
	const span = (fromPhase, toPhase) => {
		const from = marks.get(fromPhase);
		const to = toPhase === null ? end : marks.get(toPhase);
		return from === undefined || to === undefined ? null : Math.round(to - from);
	};
	return {
		timeMs: ms,
		metrics: {
			classifiedPages: result.classifiedPageCount,
			templates: result.templateCount,
			blocks: totalBlocks,
			path:
				result.classifiedPageCount > CORPUS_INLINE_THRESHOLD ? 'streaming' : 'in-memory',
			phasesMs: {
				loadingPages: span('loading-pages-start', 'collecting-stylesheets'),
				untilStageB: span('collecting-stylesheets', 'stage-b-start'),
				stageB: span('stage-b-start', 'writing-results'),
				writing: span('writing-results', null),
			},
			slowestBlockMs: Math.round(slowestBlockMs),
		},
	};
}

/**
 * Collects the pages the production factory yields (internal HTML pages
 * with retrievable HTML), in its order, without keeping their HTML. Like
 * the factory, finding out whether a page has HTML means decompressing it,
 * so this is one full pass over the corpus's HTML.
 * @param {import('@nitpicker/archive/archive').default} writable - The throwaway copy.
 * @returns {Promise<{ page: object; paths: readonly string[]; stylesheetHrefs: readonly string[]; host: string; contentRoot: object | undefined }[]>}
 *   One entry per classified page.
 */
async function collectMembers(writable) {
	const pages = [];
	await writable.getPagesWithRefs(
		PAGE_BATCH_SIZE,
		(batch) => {
			for (const page of batch) {
				pages.push(page);
			}
		},
		{ withRefs: false },
	);
	const stylesheetsByUrl = await collectPageStylesheetUrls(writable);
	const members = [];
	for (const page of pages) {
		if (!page.isInternalPage() || !(await page.getHtml())) {
			continue;
		}
		const url = page.url;
		members.push({
			page,
			paths: url.paths,
			stylesheetHrefs: stylesheetsByUrl.get(url.href) ?? [],
			host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
			contentRoot: createContentRootHint(page),
		});
	}
	return members;
}

/**
 * Caps the content depth the way Stage A does (`stage-a-per-block.ts`):
 * only when the block learned a depth.
 * @param {{ html: string; contentRoot: object | undefined; maxMainDepth: number | undefined }} params
 *   The prepared HTML and the block's learned depth.
 * @returns {string} The capped HTML.
 */
function capToDepth(params) {
	return params.maxMainDepth === undefined
		? params.html
		: capContentDepth(params.html, {
				landmark: 'main',
				contentRoot: params.contentRoot,
				maxDepth: params.maxMainDepth,
			}).remainderHtml;
}

/**
 * Re-drives the engine's stages block by block to time them separately.
 * @param {import('@nitpicker/archive/archive').default} writable - The throwaway copy.
 * @returns {Promise<{ timeMs: number; metrics: Record<string, unknown> }>} The measurement.
 */
async function runBreakdown(writable) {
	const { ms, value: metrics } = await measureMs(async () => {
		const collected = await measureMs(() => collectMembers(writable));
		const members = collected.value;
		const blocking = measureSyncMs(() =>
			groupIndicesByBlockKey(
				// Reasons included, as `classifyPageTemplates` always asks for them.
				resolveBlockKeys(filterFirstPartyStylesheetHrefs(members), {
					includeReasons: true,
				}).blockKeys,
			),
		);
		const streaming = members.length > CORPUS_INLINE_THRESHOLD;

		const totals = {
			readHtml: 0,
			landmarks: 0,
			sweep: 0,
			tokenize: 0,
			stageA: 0,
			assignTokenize: 0,
		};
		const blocks = [];
		const crossBlockUnits = [];
		for (const [blockKey, indices] of blocking.value) {
			const { sample, rest } = selectStageASample({
				indices,
				blockKey,
				corpusSize: members.length,
			});
			const read = await measureMs(async () => {
				const documents = [];
				for (const index of sample) {
					documents.push(await members[index].page.getHtml());
				}
				return documents;
			});
			const landmarked = measureSyncMs(() => {
				const landmarks = read.value.map((html) => extractLandmarks(html));
				return {
					landmarks,
					localTokens: computeLocalLandmarkTokens(landmarks),
				};
			});
			const { localTokens } = landmarked.value;
			const preparedHtml = landmarked.value.landmarks.map(
				(result) => result.remainderHtml,
			);
			// The streaming path hands Stage A landmarks without their remainder
			// (already copied into `preparedHtml`), so a block's HTML is held once.
			const landmarks = streaming
				? landmarked.value.landmarks.map((result) => ({ ...result, remainderHtml: '' }))
				: landmarked.value.landmarks;
			const contentRoots = sample.map((index) => members[index].contentRoot);

			const swept = measureSyncMs(() =>
				sample.length > 1
					? detectContentDepthCap(preparedHtml, { contentRoots })
					: undefined,
			);
			// Capped once, tokenized twice — the shape of `stageAPerBlock`.
			const tokenized = measureSyncMs(() => {
				const cappedHtml = preparedHtml.map((html, position) =>
					capToDepth({
						html,
						contentRoot: contentRoots[position],
						maxMainDepth: swept.value,
					}),
				);
				const firstPass = cappedHtml.map((html) => tokenize(html));
				if (sample.length < MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT) {
					return firstPass.map((result) => result.tokens);
				}
				const allowedClasses = resolveRecurringClasses(
					firstPass.map((result) => result.classList),
				);
				return cappedHtml.map((html) => tokenize(html, { allowedClasses }).tokens);
			});
			const stageA = measureSyncMs(() =>
				stageAPerBlock({
					blockKey,
					memberIndices: sample,
					preparedHtml,
					landmarks,
					localLandmarkTokensByPage: localTokens,
					contentRoots,
				}),
			);
			for (const unit of stageA.value.crossBlockUnits) {
				crossBlockUnits.push(unit);
			}

			let assignTokenizeMs = 0;
			for (const index of rest) {
				const restRead = await measureMs(() => members[index].page.getHtml());
				totals.readHtml += restRead.ms;
				assignTokenizeMs += measureSyncMs(() => {
					const capped = capToDepth({
						html: extractLandmarks(restRead.value).remainderHtml,
						contentRoot: members[index].contentRoot,
						maxMainDepth: stageA.value.maxMainDepth,
					});
					const { allowedClasses } = stageA.value;
					return allowedClasses === undefined
						? tokenize(capped)
						: tokenize(capped, { allowedClasses });
				}).ms;
			}

			totals.readHtml += read.ms;
			totals.landmarks += landmarked.ms;
			totals.sweep += swept.ms;
			totals.tokenize += tokenized.ms;
			totals.stageA += stageA.ms;
			totals.assignTokenize += assignTokenizeMs;
			blocks.push({
				n: indices.length,
				stageAPages: sample.length,
				u: countDistinctTokenSets(tokenized.value, localTokens),
				sweepMs: Math.round(swept.ms),
				tokenizeMs: Math.round(tokenized.ms),
				stageAOwnMs: Math.round(Math.max(0, stageA.ms - swept.ms - tokenized.ms)),
				assignTokenizeMs: Math.round(assignTokenizeMs),
			});
		}

		const stageB = measureSyncMs(() =>
			mergeCrossBlockClusters(
				crossBlockUnits,
				streaming ? { capMembers: BLOCK_SAMPLE_SIZE } : undefined,
			),
		);
		const sortedBlocks = blocks.toSorted((a, b) => b.n - a.n);
		return {
			analysisOnly: true,
			path: streaming ? 'streaming' : 'in-memory',
			classifiedPages: members.length,
			blocks: blocks.length,
			maxBlockPages: sortedBlocks[0]?.n ?? 0,
			uniqueSets: blocks.reduce((sum, block) => sum + block.u, 0),
			stageBUnits: crossBlockUnits.length,
			phasesMs: {
				collectPagesAndProbeHtml: Math.round(collected.ms),
				blocking: Math.round(blocking.ms),
				readHtml: Math.round(totals.readHtml),
				landmarks: Math.round(totals.landmarks),
				sweep: Math.round(totals.sweep),
				tokenize: Math.round(totals.tokenize),
				stageAOwn: Math.round(
					Math.max(0, totals.stageA - totals.sweep - totals.tokenize),
				),
				assignTokenize: Math.round(totals.assignTokenize),
				stageB: Math.round(stageB.ms),
			},
			largestBlocks: sortedBlocks.slice(0, LISTED_BLOCKS),
		};
	});
	return { timeMs: ms, metrics };
}

/** One runner per case in `BENCH_CASES['template-classification']`. */
const RUNNERS = { full: runFull, breakdown: runBreakdown };

await withWritableArchiveCopy(archive, async (writable) => {
	const run = RUNNERS[caseName];
	if (!run) {
		throw new Error(`bench-template-classification has no runner for case "${caseName}"`);
	}
	const { timeMs, metrics } = await run(writable);
	await reportBenchResult({
		bench: 'template-classification',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(writable.getKnex()),
		timeMs,
		metrics,
		json,
	});
});
