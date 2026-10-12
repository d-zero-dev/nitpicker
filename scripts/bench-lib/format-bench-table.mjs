/**
 * Formats bench records as a Markdown table for the baseline comments on
 * the Rust-port issues: one row per case with input size, wall clock and
 * peak RSS (sizes in MiB). Per-case metrics stay in the JSON records; the
 * table only carries what compares across implementations.
 *
 * A record whose `metrics.analysisOnly` is `true` (a run that re-drives
 * internal stages to split their cost, not the production code path) gets
 * a `*` on its case and a footnote, so its time is not read as the cost of
 * the operation itself.
 * @param {readonly {
 *   bench: string;
 *   case: string;
 *   input: { pages: number; archiveBytes: number };
 *   timeMs: number;
 *   peakRssBytes: number;
 *   metrics?: { analysisOnly?: boolean };
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
	let hasAnalysisOnly = false;
	for (const record of records) {
		const analysisOnly = record.metrics?.analysisOnly === true;
		hasAnalysisOnly ||= analysisOnly;
		const caseLabel = analysisOnly ? `${record.case}*` : record.case;
		lines.push(
			`| ${record.bench} | ${caseLabel} | ${record.input.pages} | ${mib(record.input.archiveBytes)} | ${record.timeMs} | ${mib(record.peakRssBytes)} |`,
		);
	}
	if (hasAnalysisOnly) {
		lines.push(
			'',
			'\\* Analysis run that re-drives internal stages to split their cost; its time is not the cost of the operation.',
		);
	}
	return `${lines.join('\n')}\n`;
}
