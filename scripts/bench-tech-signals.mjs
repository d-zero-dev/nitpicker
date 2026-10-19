#!/usr/bin/env node
/**
 * Baseline: the crawler's per-page structural technology detection over
 * every stored HTML snapshot of an archive.
 *
 * Cases:
 *
 * - `rust`: the shipped native implementation (`@nitpicker/archive`'s
 *   `matchStructuralTechnologySignals`, fed the decompressed HTML string as
 *   the crawl write path feeds it — so the UTF-8 encoding it does before
 *   the native call is charged to the run)
 * - `js`: the JavaScript regular expressions kept as the parity oracle,
 *   run by `archive/src/meta/technologies/match-structural-signals-in-javascript.ts`
 *   in the loop that produced the stored rows. The oracle is excluded from
 *   the build, so it is loaded from `src/` through Node's type stripping
 *   (Node 24 or later)
 *
 * Snapshots are matched with no `<meta name="generator">` value, so only the
 * HTML patterns are exercised. `timeMs` sums the match calls only, each
 * timed synchronously; the first snapshot is matched once untimed
 * beforehand so the patterns' first compilation is not charged to the run
 * (V8's optimizing tiers still warm up inside it, a cost that fades on
 * archives of thousands of pages). Decompression is timed separately
 * (`decodeMs`).
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-tech-signals.mjs <archive.nitpicker> [--case rust|js] [--json]
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { decodeStoredBlob } from '@nitpicker/archive/decode-html-blob';

import { matchStructuralTechnologySignals } from '../packages/@nitpicker/archive/lib/meta/technologies/match-structural-technology-signals.js';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { iterateHtmlBlobs } from './bench-lib/iterate-html-blobs.mjs';
import { measureSyncMs } from './bench-lib/measure-sync-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withReadOnlyArchive } from './bench-lib/with-read-only-archive.mjs';

const { archive, caseName, json } = readBenchArguments('tech-signals');

/**
 * Loads the JavaScript oracle matcher from `src/`.
 * @returns {Promise<(html: string) => unknown[]>} The JavaScript matcher.
 */
async function loadJavaScriptMatcher() {
	const oracle = '../packages/@nitpicker/archive/src/meta/technologies/';
	const { matchStructuralSignalsInJavaScript } = await import(
		`${oracle}match-structural-signals-in-javascript.ts`
	);
	const { STRUCTURAL_SIGNAL_DEFINITIONS } = await import(
		`${oracle}structural-signal-definitions.ts`
	);
	return (html) =>
		matchStructuralSignalsInJavaScript(html, STRUCTURAL_SIGNAL_DEFINITIONS);
}

/** The implementation, per case in `BENCH_CASES['tech-signals']`. */
const ENGINES = {
	rust: async () => (html) => matchStructuralTechnologySignals(html, null),
	js: loadJavaScriptMatcher,
};
const loadEngine = ENGINES[caseName];
if (!loadEngine) {
	throw new Error(`bench-tech-signals has no engine for case "${caseName}"`);
}
const match = await loadEngine();

await withReadOnlyArchive(archive, async (accessor) => {
	const knex = accessor.getKnex();
	let snapshots = 0;
	let signals = 0;
	let decodeMs = 0;
	let timeMs = 0;
	for await (const blob of iterateHtmlBlobs(knex)) {
		const decoded = measureSyncMs(() => decodeStoredBlob(blob.body, blob.codec));
		decodeMs += decoded.ms;
		if (snapshots === 0) {
			match(decoded.value);
		}
		const matched = measureSyncMs(() => match(decoded.value));
		timeMs += matched.ms;
		signals += matched.value.length;
		snapshots++;
	}
	console.error(`matched ${snapshots} snapshots`);
	await reportBenchResult({
		bench: 'tech-signals',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(knex),
		timeMs,
		metrics: { snapshots, signals, decodeMs: Math.round(decodeMs) },
		json,
	});
});
