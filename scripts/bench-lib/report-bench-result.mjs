import { stat } from 'node:fs/promises';
import process from 'node:process';

import { createBenchResult } from './create-bench-result.mjs';

/**
 * Prints one bench measurement: the {@link createBenchResult} record as a
 * single JSON line on stdout with `json`, otherwise a short human summary.
 * Progress and diagnostics belong on stderr, so that stdout stays parseable
 * for `bench-run.mjs`.
 *
 * Call it once, after the measurement: it records the process's peak RSS so
 * far (`process.resourceUsage().maxRSS`, KiB on every platform), which is
 * only that case's peak because every bench run measures a single case.
 * @param {{
 *   bench: string;
 *   caseName: string;
 *   archivePath: string;
 *   pageCount: number;
 *   timeMs: number;
 *   metrics: Record<string, unknown>;
 *   json: boolean;
 * }} params - The measurement, the archive it ran on, and the output mode.
 * @returns {Promise<void>}
 * @example
 * await reportBenchResult({
 *   bench: 'tech-signals',
 *   caseName: 'default',
 *   archivePath,
 *   pageCount,
 *   timeMs,
 *   metrics: { snapshots },
 *   json,
 * });
 */
export async function reportBenchResult(params) {
	const peakRssBytes = process.resourceUsage().maxRSS * 1024;
	const { size } = await stat(params.archivePath);
	const result = createBenchResult({
		bench: params.bench,
		caseName: params.caseName,
		pageCount: params.pageCount,
		archiveBytes: size,
		timeMs: params.timeMs,
		peakRssBytes,
		metrics: params.metrics,
		env: { node: process.version, platform: process.platform, arch: process.arch },
	});
	if (params.json) {
		process.stdout.write(`${JSON.stringify(result)}\n`);
		return;
	}
	console.log(`${result.bench} / ${result.case}: ${result.timeMs} ms`);
	console.log(`  input: ${result.input.pages} pages, ${result.input.archiveBytes} bytes`);
	console.log(`  peak RSS: ${result.peakRssBytes} bytes`);
	for (const [name, value] of Object.entries(result.metrics)) {
		console.log(`  ${name}: ${formatMetric(value)}`);
	}
}

/**
 * Renders one metric value for the human summary: objects as JSON, anything
 * else in its plain string form.
 * @param {unknown} value - The metric value.
 * @returns {string} The text to print after the metric name.
 */
function formatMetric(value) {
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	if (typeof value === 'string') {
		return value;
	}
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value);
	}
	return 'undefined';
}
