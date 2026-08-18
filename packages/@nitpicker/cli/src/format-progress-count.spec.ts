import { describe, it, expect } from 'vitest';

import { formatProgressCount } from './format-progress-count.js';

describe('formatProgressCount', () => {
	it('formats processed/total with a percentage', () => {
		expect(formatProgressCount(250, 500)).toBe('250/500 pages (50%)');
	});

	it('adds thousands separators for large counts', () => {
		expect(formatProgressCount(43_500, 43_850)).toBe('43,500/43,850 pages (99%)');
	});

	it('floors a non-round percentage instead of rounding up', () => {
		expect(formatProgressCount(1, 3)).toBe('1/3 pages (33%)');
	});

	it('reports 100% for a completed build (processed === total)', () => {
		expect(formatProgressCount(5, 5)).toBe('5/5 pages (100%)');
	});

	it('reports 100% when there is nothing to do (total is 0)', () => {
		expect(formatProgressCount(0, 0)).toBe('0/0 pages (100%)');
	});

	it('uses a custom unit noun when given (issue #294)', () => {
		expect(formatProgressCount(23, 57, 'indexes')).toBe('23/57 indexes (40%)');
	});
});
