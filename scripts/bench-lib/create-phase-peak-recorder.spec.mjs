import { describe, it, expect } from 'vitest';

import { createPhasePeakRecorder } from './create-phase-peak-recorder.mjs';

describe('createPhasePeakRecorder', () => {
	it('keeps the highest reading seen during each phase', () => {
		let reading = 0;
		const recorder = createPhasePeakRecorder(() => reading);
		recorder.startPhase('a');
		reading = 10;
		recorder.sample();
		reading = 30;
		recorder.sample();
		reading = 20;
		recorder.sample();
		recorder.startPhase('b');
		reading = 15;
		recorder.sample();
		expect(recorder.finish()).toEqual({ setup: 0, a: 30, b: 20 });
	});

	it('samples when a phase starts, so a phase that never samples still has its start reading', () => {
		let reading = 5;
		const recorder = createPhasePeakRecorder(() => reading);
		recorder.startPhase('a');
		reading = 40;
		recorder.startPhase('b');
		// 'a' ended at the moment 'b' started, which read 40.
		expect(recorder.finish()).toEqual({ setup: 5, a: 40, b: 40 });
	});

	it('merges a phase that is started again', () => {
		let reading = 1;
		const recorder = createPhasePeakRecorder(() => reading);
		recorder.startPhase('a');
		reading = 9;
		recorder.sample();
		recorder.startPhase('b');
		reading = 2;
		recorder.startPhase('a');
		reading = 4;
		recorder.sample();
		expect(recorder.finish().a).toBe(9);
	});

	it('records readings before the first phase under "setup"', () => {
		let reading = 7;
		const recorder = createPhasePeakRecorder(() => reading);
		recorder.sample();
		reading = 8;
		recorder.startPhase('a');
		expect(recorder.finish().setup).toBe(8);
	});

	it('is empty when nothing was recorded', () => {
		expect(createPhasePeakRecorder(() => 0).finish()).toEqual({ setup: 0 });
	});
});
