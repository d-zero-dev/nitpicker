/**
 * Checks the combinations of `bench-read-model-build.mjs` options that the
 * parsers cannot see on their own, before anything is opened:
 *
 * - `--gc` needs `globalThis.gc`, which only `node --expose-gc` provides.
 * - `--regions` and `--gc` have nothing to do on `--case floor`: it builds
 *   nothing, so there is no phase to sample and no progress tick to collect
 *   on. Rejected rather than ignored, so a `floor` report never looks like a
 *   `full` run with the same settings.
 * @param {{
 *   caseName: string;
 *   regions: boolean;
 *   gc: boolean;
 *   gcAvailable: boolean;
 * }} options - The parsed options and whether `globalThis.gc` exists.
 * @throws {Error} On a combination that cannot be measured.
 * @example
 * assertReadModelBuildOptions({
 *   caseName,
 *   regions,
 *   gc,
 *   gcAvailable: typeof globalThis.gc === 'function',
 * });
 */
export function assertReadModelBuildOptions({ caseName, regions, gc, gcAvailable }) {
	if (gc && !gcAvailable) {
		throw new Error('--gc needs `node --expose-gc`');
	}
	if (caseName === 'floor' && (regions || gc)) {
		throw new Error('--regions and --gc have no effect on --case floor');
	}
}
