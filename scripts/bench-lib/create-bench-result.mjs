/**
 * Builds the fixed-shape record every baseline bench emits with `--json`.
 *
 * The shape is what makes runs comparable across implementations of the
 * same operation (JavaScript and Rust, measured by the same scripts), so
 * fields are only ever added. The archive is described by its page count
 * and byte size only — never its path or name, which can identify a real
 * crawl target.
 * @param {{
 *   bench: string;
 *   caseName: string;
 *   pageCount: number;
 *   archiveBytes: number;
 *   timeMs: number;
 *   peakRssBytes: number;
 *   metrics: Record<string, unknown>;
 *   env: { node: string; platform: string; arch: string };
 * }} params - The measurement and the environment it ran in.
 * @returns {{
 *   bench: string;
 *   case: string;
 *   input: { pages: number; archiveBytes: number };
 *   env: { node: string; platform: string; arch: string };
 *   timeMs: number;
 *   peakRssBytes: number;
 *   metrics: Record<string, unknown>;
 * }} The record; `timeMs` rounded to the microsecond.
 * @example
 * createBenchResult({
 *   bench: 'body-hash',
 *   caseName: 'rust',
 *   pageCount: 2,
 *   archiveBytes: 3_312_640,
 *   timeMs: 1.5,
 *   peakRssBytes: 116_000_000,
 *   metrics: { snapshots: 2 },
 *   env: { node: 'v24.20.0', platform: 'linux', arch: 'x64' },
 * });
 */
export function createBenchResult(params) {
	return {
		bench: params.bench,
		case: params.caseName,
		input: { pages: params.pageCount, archiveBytes: params.archiveBytes },
		env: params.env,
		timeMs: Math.round(params.timeMs * 1000) / 1000,
		peakRssBytes: params.peakRssBytes,
		metrics: params.metrics,
	};
}
