/**
 * Records how long each named phase of a run took and how much of that time
 * was spent inside SQL queries, so a run can be split into "SQL" and "JS"
 * time. The caller feeds it phase changes (`startPhase`) and query start/end
 * events (`queryStarted` / `queryEnded`, e.g. from knex's `query` and
 * `query-response` events); it never reads a clock itself except through
 * `now`, which keeps the arithmetic testable.
 *
 * Queries that overlap in time count once (the union of their intervals), and
 * a query that spans a phase boundary is split between the two phases. Time
 * before the first `startPhase` goes to a `setup` phase, which appears only
 * when it is non-zero.
 * @param {() => number} [now] - Clock in milliseconds. Defaults to `performance.now`.
 * @returns {{
 *   startPhase: (name: string) => void,
 *   queryStarted: (id: string) => void,
 *   queryEnded: (id: string) => void,
 *   finish: () => {
 *     phases: Record<string, { totalMs: number, sqlMs: number, jsMs: number }>,
 *     totalMs: number,
 *     sqlMs: number,
 *     jsMs: number,
 *     jsRatio: number,
 *   },
 * }} The timeline. `finish()` closes the current phase and returns the totals.
 * @example
 * const timeline = createPhaseTimeline();
 * knex.on('query', (q) => timeline.queryStarted(q.__knexQueryUid));
 * knex.on('query-response', (_r, q) => timeline.queryEnded(q.__knexQueryUid));
 * await buildViewerReadModel(accessor, { onPhase: (name) => timeline.startPhase(name) });
 * const { phases, jsRatio } = timeline.finish();
 */
export function createPhaseTimeline(now = () => performance.now()) {
	/** @type {Map<string, { totalMs: number, sqlMs: number }>} */
	const phases = new Map();
	const activeQueries = new Set();
	let currentPhase = 'setup';
	let lastMark = now();

	/** Adds the time since the last event to the current phase. */
	function flush() {
		const at = now();
		const elapsed = at - lastMark;
		lastMark = at;
		let entry = phases.get(currentPhase);
		if (!entry) {
			if (elapsed === 0) {
				return;
			}
			entry = { totalMs: 0, sqlMs: 0 };
			phases.set(currentPhase, entry);
		}
		entry.totalMs += elapsed;
		if (activeQueries.size > 0) {
			entry.sqlMs += elapsed;
		}
	}

	return {
		startPhase(name) {
			flush();
			currentPhase = name;
			if (!phases.has(name)) {
				phases.set(name, { totalMs: 0, sqlMs: 0 });
			}
		},
		queryStarted(id) {
			flush();
			activeQueries.add(id);
		},
		queryEnded(id) {
			flush();
			activeQueries.delete(id);
		},
		finish() {
			flush();
			const result = {};
			let totalMs = 0;
			let sqlMs = 0;
			for (const [name, entry] of phases) {
				result[name] = {
					totalMs: entry.totalMs,
					sqlMs: entry.sqlMs,
					jsMs: entry.totalMs - entry.sqlMs,
				};
				totalMs += entry.totalMs;
				sqlMs += entry.sqlMs;
			}
			const jsMs = totalMs - sqlMs;
			return {
				phases: result,
				totalMs,
				sqlMs,
				jsMs,
				jsRatio: totalMs === 0 ? 0 : jsMs / totalMs,
			};
		},
	};
}
