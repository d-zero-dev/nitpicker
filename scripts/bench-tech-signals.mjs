#!/usr/bin/env node
/**
 * Baseline: `matchStructuralTechnologySignals` (the crawler's per-page
 * regular-expression technology detection) over every stored HTML snapshot
 * of an archive.
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
 *     node scripts/bench-tech-signals.mjs <archive.nitpicker> [--json]
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
			matchStructuralTechnologySignals(decoded.value, null);
		}
		const matched = measureSyncMs(() =>
			matchStructuralTechnologySignals(decoded.value, null),
		);
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
