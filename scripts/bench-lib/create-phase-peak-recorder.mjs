/**
 * Records the highest reading of a gauge (in practice the process RSS) seen
 * during each named phase of a run. The process peak RSS says how high the
 * run got, not where; this says in which phase, so the part of a build that
 * dominates memory can be found by measuring instead of guessing.
 *
 * A reading is taken when a phase starts (it counts for the phase that ends
 * and for the one that begins) and whenever `sample()` is called — the caller
 * samples from a callback that fires often inside a phase (a progress
 * callback). RSS never decreases much inside one process, so the per-phase
 * values show where the high-water mark was raised.
 * @param {() => number} readGauge - Returns the current reading.
 * @returns {{
 *   startPhase: (name: string) => void,
 *   sample: () => void,
 *   finish: () => Record<string, number>,
 * }} The recorder. `finish()` takes a last reading and returns phase → highest reading.
 * @example
 * const recorder = createPhasePeakRecorder(() => process.memoryUsage().rss);
 * await buildViewerReadModel(accessor, {
 *   onPhase: (name) => recorder.startPhase(name),
 *   onProgress: () => recorder.sample(),
 * });
 * const rssByPhase = recorder.finish();
 */
export function createPhasePeakRecorder(readGauge) {
	const peaks = new Map([['setup', readGauge()]]);
	let currentPhase = 'setup';

	/** Raises the current phase's peak to the current reading. */
	function sample() {
		const reading = readGauge();
		if (reading > (peaks.get(currentPhase) ?? 0)) {
			peaks.set(currentPhase, reading);
		}
	}

	return {
		startPhase(name) {
			sample();
			currentPhase = name;
			if (!peaks.has(name)) {
				peaks.set(name, 0);
			}
			sample();
		},
		sample,
		finish() {
			sample();
			return Object.fromEntries(peaks);
		},
	};
}
