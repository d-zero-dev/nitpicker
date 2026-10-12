/* eslint-disable no-console */

import process from 'node:process';

import { BENCH_CASES } from './bench-cases.mjs';
import { parseBenchArguments } from './parse-bench-arguments.mjs';

/**
 * Reads a baseline bench script's command line ({@link parseBenchArguments}
 * with the bench's cases from {@link BENCH_CASES}, the first one being the
 * default). A usage error is a user mistake, not a crash, so it is printed
 * as one message with the usage line and the process exits with code 1
 * instead of throwing a stack trace.
 * @param {string} bench - The bench name (`body-hash` for `bench-body-hash.mjs`).
 * @param {string[]} [argv] - The arguments to parse (default: `process.argv`
 *   after the script).
 * @returns {{ archive: string; caseName: string; json: boolean }} The parsed
 *   arguments.
 * @example
 * const { archive, caseName, json } = readBenchArguments('body-hash');
 */
export function readBenchArguments(bench, argv = process.argv.slice(2)) {
	const cases = BENCH_CASES[bench];
	let parsed;
	try {
		parsed = parseBenchArguments(argv, { cases, defaultCase: cases[0] });
	} catch (error) {
		console.error(error.message);
		console.error(
			`Usage: node scripts/bench-${bench}.mjs <archive.nitpicker> [--case ${cases.join('|')}] [--json]`,
		);
		process.exit(1);
	}
	return parsed;
}
