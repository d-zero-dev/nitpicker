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
 * `walBytesAtPhaseStart` is the size of the archive's WAL file when each phase
 * starts: the build writes the whole read model into the WAL inside one
 * transaction, so this shows how the uncommitted write set grows and whether
 * memory tracks it. The `final` entry is taken after the build, that is after
 * its `wal_checkpoint(TRUNCATE)`, so it is 0 by construction. With
 * `--regions`, `memoryRegionsAtPhaseStart` adds, at the same moments, the
 * process's resident memory by region type from the OS (`vmmap --summary` on
 * macOS, `/proc/self/status` on Linux — see `bench-lib/read-memory-regions.mjs`
 * for the two shapes, and `null` with one warning on stderr where neither can
 * be read), which tells `malloc`ed memory (SQLite's page cache, row buffers)
 * from the database file mapped by `PRAGMA mmap_size` and from WAL shared
 * memory. It is taken at phase starts only, because the macOS snapshot
 * suspends the process for about a second each time — that time is inside
 * `timeMs`, so compare times between runs that both use `--regions` or
 * neither. These options exist only on this script: `bench-run.mjs` and
 * `bench-suite.mjs` pass nothing but `--case`.
 *
 * `--pragma name=value` (repeatable) applies a connection PRAGMA to the
 * build's connection before the build, on top of the archive's defaults
 * (`applyConnectionPragmas`), to compare settings such as `temp_store`,
 * `cache_spill` or `wal_autocheckpoint`. `mmap_size` and `cache_size` are
 * rejected: the build sets its own values for the two on entry
 * (`withBulkWritePragmas`) and would overwrite the option's. The PRAGMAs
 * applied are reported as `pragmas`, for `floor` too.
 *
 * `--gc` (with `node --expose-gc`) forces a full garbage collection at every
 * progress tick and reports `gcEachProgress: true`. A diagnostic, not a
 * measurement of the build: it separates native memory that is only waiting
 * for its JS wrapper to be collected (a prepared statement's compiled program
 * and copied bindings) from memory held for other reasons.
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
 *     node scripts/bench-read-model-build.mjs <archive.nitpicker> [--case full|floor] [--json] \
 *       [--regions] [--pragma name=value ...] [--gc]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import process from 'node:process';

import { buildViewerReadModel } from '@nitpicker/query';

import { assertReadModelBuildOptions } from './bench-lib/assert-read-model-build-options.mjs';
import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { createPhasePeakRecorder } from './bench-lib/create-phase-peak-recorder.mjs';
import { createPhaseStartSampler } from './bench-lib/create-phase-start-sampler.mjs';
import { createPhaseTimeline } from './bench-lib/create-phase-timeline.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { takeReadModelBuildOptions } from './bench-lib/take-read-model-build-options.mjs';
import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';

const USAGE =
	'Usage: node [--expose-gc] scripts/bench-read-model-build.mjs <archive.nitpicker> ' +
	'[--case full|floor] [--json] [--regions] [--pragma name=value ...] [--gc]';

/**
 * Reports a usage mistake with the usage line and exits with code 1, the
 * same way `readBenchArguments` does for the shared options.
 * @param {string} message - What was wrong.
 */
function exitWithUsage(message) {
	console.error(message);
	console.error(USAGE);
	process.exit(1);
}

let buildOptions;
try {
	buildOptions = takeReadModelBuildOptions(process.argv.slice(2));
} catch (error) {
	exitWithUsage(error.message);
}
const { pragmas, regions, gc } = buildOptions;
const { archive, caseName, json } = readBenchArguments(
	'read-model-build',
	buildOptions.rest,
);
try {
	assertReadModelBuildOptions({
		caseName,
		regions,
		gc,
		gcAvailable: typeof globalThis.gc === 'function',
	});
} catch (error) {
	exitWithUsage(error.message);
}

await withWritableArchiveCopy(archive, async (writable) => {
	const knex = writable.getKnex();
	const pageCount = await countInternalPages(knex);
	for (const { name, value } of pragmas) {
		await knex.raw(`PRAGMA ${name} = ${value}`);
	}

	if (caseName === 'floor') {
		// Same metadata as a `full` run with the same flags, so the two can
		// be paired by their settings.
		await reportBenchResult({
			bench: 'read-model-build',
			caseName,
			archivePath: archive,
			pageCount,
			timeMs: 0,
			metrics: { pragmas, gcEachProgress: gc },
			json,
		});
		return;
	}

	const timeline = createPhaseTimeline();
	const rssRecorder = createPhasePeakRecorder(() => process.memoryUsage.rss());
	const heapRecorder = createPhasePeakRecorder(() => process.memoryUsage().heapUsed);
	const externalRecorder = createPhasePeakRecorder(() => process.memoryUsage().external);
	const sampler = createPhaseStartSampler({ tmpDir: writable.tmpDir, regions });
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
				sampler.sample(phase);
			},
			onProgress: () => {
				if (gc) {
					globalThis.gc();
				}
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
	sampler.sample('final');
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
			walBytesAtPhaseStart: sampler.walBytesAtPhaseStart,
			...(regions
				? { memoryRegionsAtPhaseStart: sampler.memoryRegionsAtPhaseStart }
				: {}),
			pragmas,
			gcEachProgress: gc,
		},
		json,
	});
});
