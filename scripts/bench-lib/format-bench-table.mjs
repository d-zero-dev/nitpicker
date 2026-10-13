/**
 * Formats bench records as a Markdown table for the baseline comments on
 * the Rust-port issues: one row per case with input size, wall clock and
 * peak RSS (sizes in MiB). Per-case metrics stay in the JSON records; the
 * table only carries what compares across implementations.
 * @param {readonly {
 *   bench: string;
 *   case: string;
 *   input: { pages: number; archiveBytes: number };
 *   timeMs: number;
 *   peakRssBytes: number;
 * }[]} records - Records from `runBenchProcess`.
 * @returns {string} The table, newline-terminated.
 * @example
 * formatBenchTable([record]);
 * // | bench | case | pages | archive (MiB) | time (ms) | peak RSS (MiB) |
 * // |---|---|--:|--:|--:|--:|
 * // | body-hash | rust | 2 | 3.2 | 1.5 | 61.2 |
 */
export function formatBenchTable(records) {
	const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);
	const lines = [
		'| bench | case | pages | archive (MiB) | time (ms) | peak RSS (MiB) |',
		'|---|---|--:|--:|--:|--:|',
	];
	for (const record of records) {
		lines.push(
			`| ${record.bench} | ${record.case} | ${record.input.pages} | ${mib(record.input.archiveBytes)} | ${record.timeMs} | ${mib(record.peakRssBytes)} |`,
		);
	}
	return `${lines.join('\n')}\n`;
}
