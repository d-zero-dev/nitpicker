/* eslint-disable no-console */

/**
 * Runs the selected benches' cases one after another and collects the
 * records, carrying on past a failed case so one broken bench does not hide
 * the state of the others. The caller decides the exit status from
 * `failures`.
 * @param {{
 *   cases: Readonly<Record<string, readonly string[]>>;
 *   only: ReadonlySet<string>;
 *   runCase: (bench: string, caseName: string) => Promise<Record<string, unknown>>;
 * }} params - Every bench and its cases (`BENCH_CASES`), the benches to
 *   run (empty: all), and the function that runs one case
 *   (`runBenchProcess` in the suite).
 * @returns {Promise<{ records: Record<string, unknown>[]; failures: string[] }>}
 *   The successful records in run order, and `"<bench> / <case>"` for each
 *   failed case (its error is printed to stderr).
 * @example
 * const { records, failures } = await runBenchSuite({
 *   cases: BENCH_CASES,
 *   only: new Set(),
 *   runCase: (bench, caseName) => runBenchProcess({ bench, archive, caseName }),
 * });
 */
export async function runBenchSuite(params) {
	const records = [];
	const failures = [];
	for (const [bench, cases] of Object.entries(params.cases)) {
		if (params.only.size > 0 && !params.only.has(bench)) {
			continue;
		}
		for (const caseName of cases) {
			console.error(`\n== ${bench} / ${caseName} ==`);
			try {
				records.push(await params.runCase(bench, caseName));
			} catch (error) {
				console.error(error instanceof Error ? error.message : error);
				failures.push(`${bench} / ${caseName}`);
			}
		}
	}
	return { records, failures };
}
