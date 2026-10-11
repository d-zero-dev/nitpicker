/**
 * Parses `bench-suite.mjs`'s command line: one archive path and any number
 * of `--only <bench>` filters.
 * @param {string[]} argv - Arguments after the script path.
 * @param {readonly string[]} benchNames - The benches the suite knows.
 * @returns {{ archive: string; only: Set<string> }} The archive and the
 *   selected benches (empty: all).
 * @throws {Error} On a missing archive, a second positional argument, an
 *   unknown flag, `--only` without a value, or an unknown bench name.
 * @example
 * parseSuiteArguments(['site.nitpicker', '--only', 'body-hash'], ['body-hash']);
 * // { archive: 'site.nitpicker', only: Set { 'body-hash' } }
 */
export function parseSuiteArguments(argv, benchNames) {
	let archive;
	const only = new Set();
	for (let i = 0; i < argv.length; i++) {
		const argument = argv[i];
		if (argument === '--only') {
			const name = argv[i + 1];
			if (name === undefined || name.startsWith('--')) {
				throw new Error('--only needs a bench name');
			}
			if (!benchNames.includes(name)) {
				throw new Error(
					`Unknown bench "${name}" (expected one of: ${benchNames.join(', ')})`,
				);
			}
			only.add(name);
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
	return { archive, only };
}
