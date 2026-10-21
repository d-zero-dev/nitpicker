#!/usr/bin/env node
/**
 * Baseline: `buildViewerReadModel` (the full `viewer_*` rebuild that
 * `viewer-build` and crawl completion run), split into SQL time and JS time.
 *
 * Cases:
 *
 *   - `full`: builds the read model on a throwaway extracted copy of the
 *     archive (the source file is never modified) with the same
 *     `onPhase` / `onProgress` callbacks the CLI passes. `timeMs` is the
 *     whole build, including the final WAL checkpoint.
 *   - `floor`: opens the same copy and builds nothing. Its peak RSS is the
 *     part of a `full` run's peak RSS that no change to the build can remove
 *     (Node itself, module loading, opening the archive), so compare
 *     `full - floor` between implementations, and report the raw values too.
 *
 * Metrics (`full` only): `sqlMs` / `jsMs` / `jsRatio` for the whole build,
 * `phases` with the same three numbers per build phase, and `rssByPhase`, the
 * highest process RSS (bytes) sampled during each phase (at each phase start and
 * at every progress callback) — it shows in which phase the peak was raised.
 * `heapUsedByPhase` and `externalByPhase` sample V8's used heap and its
 * external memory (Buffers, ArrayBuffers) the same way, to tell JS objects from
 * native buffers when RSS grows; the rest of RSS is memory the native SQLite
 * library and the allocator hold.
 *
 * SQL time is the union of the intervals between knex's `query` event and its
 * `query-response` / `query-error` event, so it is an upper bound on time the
 * database spends: libsql runs the statement and turns the rows into JS
 * objects in one synchronous native call, and there is no way to tell the two
 * apart from here. The object-building share is JS-side work a native
 * implementation would remove, so `jsRatio` is a lower bound on the JS share.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-read-model-build.mjs <archive.nitpicker> [--case full|floor] [--json]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import process from 'node:process';

import { buildViewerReadModel } from '@nitpicker/query';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { createPhasePeakRecorder } from './bench-lib/create-phase-peak-recorder.mjs';
import { createPhaseTimeline } from './bench-lib/create-phase-timeline.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';

const { archive, caseName, json } = readBenchArguments('read-model-build');

await withWritableArchiveCopy(archive, async (writable) => {
	const knex = writable.getKnex();
	const pageCount = await countInternalPages(knex);

	if (caseName === 'floor') {
		await reportBenchResult({
			bench: 'read-model-build',
			caseName,
			archivePath: archive,
			pageCount,
			timeMs: 0,
			metrics: {},
			json,
		});
		return;
	}

	const timeline = createPhaseTimeline();
	const rssRecorder = createPhasePeakRecorder(() => process.memoryUsage.rss());
	const heapRecorder = createPhasePeakRecorder(() => process.memoryUsage().heapUsed);
	const externalRecorder = createPhasePeakRecorder(() => process.memoryUsage().external);
	knex.on('query', (query) => timeline.queryStarted(query.__knexQueryUid));
	knex.on('query-response', (_response, query) =>
		timeline.queryEnded(query.__knexQueryUid),
	);
	knex.on('query-error', (_error, query) => timeline.queryEnded(query.__knexQueryUid));

	const { ms } = await measureMs(() =>
		buildViewerReadModel(writable, {
			onPhase: (phase) => {
				timeline.startPhase(phase);
				rssRecorder.startPhase(phase);
				heapRecorder.startPhase(phase);
				externalRecorder.startPhase(phase);
			},
			onProgress: () => {
				rssRecorder.sample();
				heapRecorder.sample();
				externalRecorder.sample();
			},
		}),
	);
	const { phases, sqlMs, jsMs, jsRatio } = timeline.finish();
	const rssByPhase = rssRecorder.finish();
	const heapUsedByPhase = heapRecorder.finish();
	const externalByPhase = externalRecorder.finish();
	await reportBenchResult({
		bench: 'read-model-build',
		caseName,
		archivePath: archive,
		pageCount,
		timeMs: ms,
		metrics: {
			sqlMs,
			jsMs,
			jsRatio,
			phases,
			rssByPhase,
			heapUsedByPhase,
			externalByPhase,
		},
		json,
	});
});
