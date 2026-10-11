#!/usr/bin/env node
/**
 * Baseline: `searchHtml` (`query search-html`) over a whole archive, end to
 * end (SQLite read + zstd decode + matching), counts only (`limit: 0`).
 *
 * Cases cover the two pattern kinds against many and few hits:
 *
 * - `literal-many`: `<div` — matches nearly every snapshot
 * - `literal-few`: a token no real page contains — every snapshot scanned,
 *   none matched
 * - `regex-many`: `/<a\s[^>]*href=/i`
 * - `regex-few`: `/data-nitpicker-bench-absent="\d+"/`
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-search-html.mjs <archive.nitpicker> [--case <case>] [--json]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { searchHtml } from '@nitpicker/query';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withReadOnlyArchive } from './bench-lib/with-read-only-archive.mjs';

/** One pattern per case in `BENCH_CASES['search-html']`. */
const PATTERNS = {
	'literal-many': '<div',
	'literal-few': 'nitpicker-bench-absent-token',
	'regex-many': String.raw`/<a\s[^>]*href=/i`,
	'regex-few': String.raw`/data-nitpicker-bench-absent="\d+"/`,
};

const { archive, caseName, json } = readBenchArguments('search-html');

const pattern = PATTERNS[caseName];
if (pattern === undefined) {
	throw new Error(`bench-search-html has no pattern for case "${caseName}"`);
}

await withReadOnlyArchive(archive, async (accessor) => {
	const { ms, value: result } = await measureMs(() =>
		searchHtml(accessor, { pattern, limit: 0 }),
	);
	await reportBenchResult({
		bench: 'search-html',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(accessor.getKnex()),
		timeMs: ms,
		metrics: {
			pattern,
			scannedSnapshots: result.scannedSnapshots,
			candidatePages: result.candidatePages,
			matchedPages: result.total,
		},
		json,
	});
});
