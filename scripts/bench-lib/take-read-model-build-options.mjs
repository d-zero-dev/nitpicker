const PRAGMA_PAIR = /^([a-z_]+)=(-?\d+|[A-Za-z_]+)$/;

/**
 * PRAGMAs the build sets itself on entry (`withBulkWritePragmas`), so a value
 * given here would be overwritten and the report would name a setting the
 * build did not run with. Rejected rather than ignored, like every other
 * option that would measure something other than what was asked.
 */
const PRAGMAS_SET_BY_THE_BUILD = new Set(['mmap_size', 'cache_size']);

/**
 * Takes the options only `bench-read-model-build.mjs` understands out of its
 * command line, leaving the rest for {@link parseBenchArguments}, which
 * rejects any option it does not know:
 *
 * - `--pragma name=value` (repeatable): a connection PRAGMA to apply before
 *   the build, to compare settings such as `temp_store`, `cache_spill` or
 *   `wal_autocheckpoint`. The pair must be a bare name and a number or word,
 *   since it is interpolated into `PRAGMA name = value`. `mmap_size` and
 *   `cache_size` are rejected ({@link PRAGMAS_SET_BY_THE_BUILD}).
 * - `--regions`: also read the process's memory by region type at each phase
 *   boundary ({@link readMemoryRegions}).
 * - `--gc`: run a full garbage collection at every progress tick (needs
 *   `node --expose-gc`). A diagnostic: native memory that only a collected
 *   JS wrapper releases (a prepared statement's compiled program and copied
 *   bindings) disappears from the peak with this on, memory held elsewhere
 *   (SQLite's page cache, the WAL index) does not.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{
 *   rest: string[];
 *   pragmas: Array<{ name: string; value: string }>;
 *   regions: boolean;
 *   gc: boolean;
 * }} The remaining arguments, the PRAGMAs in the order given, and the flags.
 * @throws {Error} When `--pragma` has no value, the value is not
 *   `name=value`, or the name is one the build sets itself.
 * @example
 * const { rest, pragmas, regions, gc } = takeReadModelBuildOptions(process.argv.slice(2));
 * const { archive, caseName, json } = readBenchArguments('read-model-build', rest);
 */
export function takeReadModelBuildOptions(argv) {
	const rest = [];
	const pragmas = [];
	let regions = false;
	let gc = false;
	for (let i = 0; i < argv.length; i++) {
		const argument = argv[i];
		if (argument === '--regions') {
			regions = true;
			continue;
		}
		if (argument === '--gc') {
			gc = true;
			continue;
		}
		if (argument !== '--pragma') {
			rest.push(argument);
			continue;
		}
		const value = argv[i + 1];
		if (value === undefined || value.startsWith('--') || !value.includes('=')) {
			throw new Error('--pragma needs a name=value');
		}
		const match = PRAGMA_PAIR.exec(value);
		if (!match) {
			throw new Error(
				`Invalid pragma "${value}" (expected a bare name and a number or word)`,
			);
		}
		if (PRAGMAS_SET_BY_THE_BUILD.has(match[1])) {
			throw new Error(
				`--pragma ${match[1]} cannot be varied: the build sets it itself (withBulkWritePragmas)`,
			);
		}
		pragmas.push({ name: match[1], value: match[2] });
		i++;
	}
	return { rest, pragmas, regions, gc };
}
