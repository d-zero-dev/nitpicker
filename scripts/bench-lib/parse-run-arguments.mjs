/**
 * Parses `bench-run.mjs`'s command line: the bench name, the archive and
 * `--case <case>` — exactly what a bench script accepts besides `--json`,
 * which the runner always adds. The bench and case are checked against the
 * baseline list, so an unrelated `scripts/bench-*.mjs` (one that ignores
 * `--case`/`--json`) is never spawned and run to completion for nothing.
 * @param {string[]} argv - Arguments after the script path.
 * @param {Readonly<Record<string, readonly string[]>>} cases - Every baseline
 *   bench and its cases (`BENCH_CASES`).
 * @returns {{ bench: string; archive: string; caseName: string }} The parsed
 *   arguments.
 * @throws {Error} When the bench or archive is missing (or is a flag), the
 *   bench or case is not a baseline one, `--case` is missing, has no value
 *   or is given twice (the bench would measure the last one while the record
 *   is filed under the first), or any other argument is present.
 * @example
 * parseRunArguments(['body-hash', 'site.nitpicker', '--case', 'js'], BENCH_CASES);
 * // { bench: 'body-hash', archive: 'site.nitpicker', caseName: 'js' }
 */
export function parseRunArguments(argv, cases) {
	const [bench, archive, ...rest] = argv;
	if (bench === undefined || bench.startsWith('--')) {
		throw new Error('Missing the bench name');
	}
	const benchCases = cases[bench];
	if (benchCases === undefined) {
		throw new Error(
			`Unknown bench "${bench}" (expected one of: ${Object.keys(cases).join(', ')})`,
		);
	}
	if (archive === undefined || archive.startsWith('--')) {
		throw new Error('Missing the archive path');
	}
	const caseIndex = rest.indexOf('--case');
	const caseName = caseIndex === -1 ? undefined : rest[caseIndex + 1];
	if (caseName === undefined || caseName.startsWith('--')) {
		throw new Error('--case <case> is required');
	}
	if (rest.includes('--case', caseIndex + 1)) {
		throw new Error('--case is given more than once');
	}
	if (!benchCases.includes(caseName)) {
		throw new Error(
			`Unknown case "${caseName}" (expected one of: ${benchCases.join(', ')})`,
		);
	}
	const extra = rest.find((_, index) => index !== caseIndex && index !== caseIndex + 1);
	if (extra !== undefined) {
		throw new Error(`Unexpected argument: ${extra}`);
	}
	return { bench, archive, caseName };
}
