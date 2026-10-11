#!/usr/bin/env node
/**
 * Runs every baseline bench case (the Rust-port benchmarks of #424, listed
 * in `bench-lib/bench-cases.mjs`) against one archive, each in its own
 * process, then saves all records to `bench-output/suite-<timestamp>.json`
 * and prints a Markdown table on stdout.
 *
 * Exits non-zero if any case fails, so CI runs it as a smoke test on the
 * committed fixture archive: the values are not checked, but every case
 * must run and print its record.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-suite.mjs <archive.nitpicker> [--only <bench>]...
 *
 * See `scripts/README.md`.
 */

/* eslint-disable no-console */

import process from 'node:process';

import { BENCH_CASES } from './bench-lib/bench-cases.mjs';
import { formatBenchTable } from './bench-lib/format-bench-table.mjs';
import { parseSuiteArguments } from './bench-lib/parse-suite-arguments.mjs';
import { runBenchProcess } from './bench-lib/run-bench-process.mjs';
import { runBenchSuite } from './bench-lib/run-bench-suite.mjs';
import { writeBenchOutput } from './bench-lib/write-bench-output.mjs';

let parsed;
try {
	parsed = parseSuiteArguments(process.argv.slice(2), Object.keys(BENCH_CASES));
} catch (error) {
	console.error(error.message);
	console.error(
		'Usage: node scripts/bench-suite.mjs <archive.nitpicker> [--only <bench>]...',
	);
	process.exit(1);
}
const { archive, only } = parsed;

const { records, failures } = await runBenchSuite({
	cases: BENCH_CASES,
	only,
	runCase: (bench, caseName) => runBenchProcess({ bench, archive, caseName }),
});

const file = await writeBenchOutput({ name: 'suite', data: records });
console.error(`\nsaved ${file}`);
const env = records[0]?.env;
if (env) {
	process.stdout.write(`Node ${env.node}, ${env.platform}-${env.arch}\n\n`);
}
process.stdout.write(formatBenchTable(records));
if (failures.length > 0) {
	console.error(`\nFailed: ${failures.join(', ')}`);
	process.exitCode = 1;
}
