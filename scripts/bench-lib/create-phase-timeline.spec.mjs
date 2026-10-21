import { describe, it, expect } from 'vitest';

import { createPhaseTimeline } from './create-phase-timeline.mjs';

/**
 * A manually advanced clock, so the timeline's arithmetic is exact.
 * @returns {{ now: () => number, advance: (ms: number) => void }}
 */
function createClock() {
	let current = 0;
	return {
		now: () => current,
		advance: (ms) => {
			current += ms;
		},
	};
}

describe('createPhaseTimeline', () => {
	it('splits each phase into SQL and JS time', () => {
		const clock = createClock();
		const timeline = createPhaseTimeline(clock.now);
		timeline.startPhase('loading');
		clock.advance(10);
		timeline.queryStarted('q1');
		clock.advance(30);
		timeline.queryEnded('q1');
		clock.advance(20);
		timeline.startPhase('building');
		clock.advance(40);

		const result = timeline.finish();

		expect(result.phases.loading).toEqual({ totalMs: 60, sqlMs: 30, jsMs: 30 });
		expect(result.phases.building).toEqual({ totalMs: 40, sqlMs: 0, jsMs: 40 });
		expect(result.totalMs).toBe(100);
		expect(result.sqlMs).toBe(30);
		expect(result.jsMs).toBe(70);
		expect(result.jsRatio).toBeCloseTo(0.7);
	});

	it('counts overlapping queries once', () => {
		const clock = createClock();
		const timeline = createPhaseTimeline(clock.now);
		timeline.startPhase('p');
		timeline.queryStarted('a');
		clock.advance(10);
		timeline.queryStarted('b');
		clock.advance(10);
		timeline.queryEnded('a');
		clock.advance(10);
		timeline.queryEnded('b');
		clock.advance(10);

		const result = timeline.finish();

		expect(result.phases.p).toEqual({ totalMs: 40, sqlMs: 30, jsMs: 10 });
	});

	it('splits a query that spans a phase boundary between the two phases', () => {
		const clock = createClock();
		const timeline = createPhaseTimeline(clock.now);
		timeline.startPhase('first');
		timeline.queryStarted('q');
		clock.advance(10);
		timeline.startPhase('second');
		clock.advance(5);
		timeline.queryEnded('q');
		clock.advance(5);

		const result = timeline.finish();

		expect(result.phases.first).toEqual({ totalMs: 10, sqlMs: 10, jsMs: 0 });
		expect(result.phases.second).toEqual({ totalMs: 10, sqlMs: 5, jsMs: 5 });
	});

	it('accumulates a phase that is started again', () => {
		const clock = createClock();
		const timeline = createPhaseTimeline(clock.now);
		timeline.startPhase('a');
		clock.advance(5);
		timeline.startPhase('b');
		clock.advance(5);
		timeline.startPhase('a');
		clock.advance(5);

		const result = timeline.finish();

		expect(result.phases.a.totalMs).toBe(10);
		expect(Object.keys(result.phases)).toEqual(['a', 'b']);
	});

	it('attributes time before the first phase to "setup"', () => {
		const clock = createClock();
		const timeline = createPhaseTimeline(clock.now);
		clock.advance(7);
		timeline.startPhase('p');
		clock.advance(3);

		const result = timeline.finish();

		expect(result.phases.setup).toEqual({ totalMs: 7, sqlMs: 0, jsMs: 7 });
		expect(result.phases.p.totalMs).toBe(3);
	});

	it('ignores an end for a query it never saw and a repeated end', () => {
		const clock = createClock();
		const timeline = createPhaseTimeline(clock.now);
		timeline.startPhase('p');
		timeline.queryEnded('ghost');
		timeline.queryStarted('q');
		clock.advance(10);
		timeline.queryEnded('q');
		timeline.queryEnded('q');
		clock.advance(10);

		const result = timeline.finish();

		expect(result.phases.p).toEqual({ totalMs: 20, sqlMs: 10, jsMs: 10 });
	});

	it('closes a query still running at finish()', () => {
		const clock = createClock();
		const timeline = createPhaseTimeline(clock.now);
		timeline.startPhase('p');
		timeline.queryStarted('q');
		clock.advance(10);

		const result = timeline.finish();

		expect(result.phases.p).toEqual({ totalMs: 10, sqlMs: 10, jsMs: 0 });
	});

	it('reports a zero JS ratio for an empty timeline', () => {
		const clock = createClock();
		const result = createPhaseTimeline(clock.now).finish();
		expect(result.totalMs).toBe(0);
		expect(result.jsRatio).toBe(0);
	});
});
