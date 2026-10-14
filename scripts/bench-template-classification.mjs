#!/usr/bin/env node
/**
 * Baseline: crawl-end template classification (the classifier in
 * `@nitpicker/core`, driven by archive's `page-cluster/`).
 *
 * `full`: `classifyArchivePageTemplates` exactly as crawl / viewer-build run
 * it, including the write. `phasesMs` splits the wall clock at the progress
 * events it emits: `loadingPages` (page handles), `untilStageB` (stylesheet
 * references, the stored-HTML listing, Pass 0, HTML reads, Stage A of every
 * block and, for sampled blocks, the assignment of pages outside the
 * samples), `stageB` (cross-block merge and cluster reasons) and `writing`.
 * `slowestBlockMs` is the longest gap between two consecutive blocks
 * finishing. `sampledBlocks` and `sampledPages` count the blocks clustered
 * from a sample because their similarity table exceeded the memory budget,
 * and their pages.
 *
 * `NITPICKER_TEMPLATE_MEMORY_BUDGET` (MiB) sets the budget as it does for
 * the CLI; `0` samples every block.
 *
 * It runs on a throwaway extracted copy; the source archive is never
 * modified. Block keys are never printed: they carry the crawled site's
 * paths and hosts.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-template-classification.mjs <archive.nitpicker> [--case full] [--json]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { classifyArchivePageTemplates } from '@nitpicker/archive/template-classification/classify-archive-page-templates';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';

const { archive, caseName, json } = readBenchArguments('template-classification');

// Parsed here, not through the CLI's `resolveTemplateMemoryBudget`: a script
// cannot import the CLI's source, and `@nitpicker/cli` exports no such
// module. Keep the two readings (MiB, blank means default) in step.
const budgetMiB = process.env.NITPICKER_TEMPLATE_MEMORY_BUDGET;
const memoryBudget =
	budgetMiB === undefined || budgetMiB.trim() === ''
		? undefined
		: Math.floor(Number(budgetMiB) * 1024 * 1024);
if (memoryBudget !== undefined && !(memoryBudget >= 0)) {
	throw new Error(
		`NITPICKER_TEMPLATE_MEMORY_BUDGET="${budgetMiB}" is not a non-negative number of MiB`,
	);
}

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
			...(memoryBudget === undefined ? {} : { memoryBudget }),
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
			sampledBlocks: result.sampledBlocks.length,
			sampledPages: result.sampledBlocks.reduce((sum, block) => sum + block.pageCount, 0),
			phasesMs: {
				listingSnapshots: span('listing-html-snapshots', 'loading-pages-start'),
				loadingPages: span('loading-pages-start', 'collecting-stylesheets'),
				untilStageB: span('collecting-stylesheets', 'stage-b-start'),
				stageB: span('stage-b-start', 'writing-results'),
				writing: span('writing-results', null),
			},
			slowestBlockMs: Math.round(slowestBlockMs),
		},
	};
}

/** One runner per case in `BENCH_CASES['template-classification']`. */
const RUNNERS = { full: runFull };

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
