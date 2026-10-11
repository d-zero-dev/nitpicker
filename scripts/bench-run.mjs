#!/usr/bin/env node
/**
 * Runs one baseline bench case in its own process and records it: prints
 * the record as one JSON line on stdout and saves it under `bench-output/`.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-run.mjs <bench> <archive.nitpicker> --case <case>
 *
 * `<bench>` is the script name without `bench-` and `.mjs`
 * (`body-hash` runs `bench-body-hash.mjs`). See `scripts/README.md`.
 */

/* eslint-disable no-console */

import process from 'node:process';

import { BENCH_CASES } from './bench-lib/bench-cases.mjs';
import { parseRunArguments } from './bench-lib/parse-run-arguments.mjs';
import { runBenchProcess } from './bench-lib/run-bench-process.mjs';
import { writeBenchOutput } from './bench-lib/write-bench-output.mjs';

let parsed;
try {
	parsed = parseRunArguments(process.argv.slice(2), BENCH_CASES);
} catch (error) {
	console.error(error.message);
	console.error(
		'Usage: node scripts/bench-run.mjs <bench> <archive.nitpicker> --case <case>',
	);
	process.exit(1);
}

try {
	const record = await runBenchProcess(parsed);
	const file = await writeBenchOutput({
		name: `${parsed.bench}-${parsed.caseName}`,
		data: record,
	});
	console.error(`saved ${file}`);
	process.stdout.write(`${JSON.stringify(record)}\n`);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
