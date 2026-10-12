/**
 * Parses the command line shared by the `scripts/bench-*.mjs` baselines:
 * one positional archive path, `--case <name>` (one case per run, so the
 * process's peak RSS belongs to that case alone) and `--json`. Any other
 * option is rejected rather than ignored, so a typo cannot silently measure
 * something other than what was asked.
 * @param {string[]} argv - Arguments after the script path.
 * @param {{ cases: readonly string[]; defaultCase: string }} spec - The cases
 *   the script supports and the one used when `--case` is omitted.
 * @returns {{ archive: string; caseName: string; json: boolean }} The parsed
 *   arguments.
 * @throws {Error} When the archive is missing, the case or an option is
 *   unknown, or `--case` has no value or is given twice.
 * @example
 * parseBenchArguments(['site.nitpicker', '--case', 'js', '--json'], {
 *   cases: ['rust', 'js'],
 *   defaultCase: 'rust',
 * });
 * // { archive: 'site.nitpicker', caseName: 'js', json: true }
 */
export function parseBenchArguments(argv, spec) {
	let archive;
	let caseName = spec.defaultCase;
	let caseGiven = false;
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const argument = argv[i];
		if (argument === '--json') {
			json = true;
			continue;
		}
		if (argument === '--case') {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith('--')) {
				throw new Error('--case needs a value');
			}
			if (caseGiven) {
				throw new Error('--case is given more than once');
			}
			caseGiven = true;
			caseName = value;
			i++;
			continue;
		}
		if (argument.startsWith('--')) {
			throw new Error(`Unknown option ${argument}`);
		}
		if (archive !== undefined) {
			throw new Error(`Unexpected extra argument: ${argument}`);
		}
		archive = argument;
	}
	if (archive === undefined) {
		throw new Error('Missing the archive path');
	}
	if (!spec.cases.includes(caseName)) {
		throw new Error(
			`Unknown case "${caseName}" (expected one of: ${spec.cases.join(', ')})`,
		);
	}
	return { archive, caseName, json };
}
