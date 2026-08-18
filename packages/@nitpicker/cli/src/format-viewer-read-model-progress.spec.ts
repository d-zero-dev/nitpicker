import { describe, it, expect } from 'vitest';

import { formatViewerReadModelProgress } from './format-viewer-read-model-progress.js';

describe('formatViewerReadModelProgress', () => {
	it('formats insertedRows/totalRows with a percentage, no timestamp', () => {
		expect(formatViewerReadModelProgress({ insertedRows: 50, totalRows: 100 })).toBe(
			'%braille% Building viewer read model: 50/100 pages (50%)',
		);
	});

	it('formats a completed build (insertedRows === totalRows)', () => {
		expect(formatViewerReadModelProgress({ insertedRows: 5, totalRows: 5 })).toBe(
			'%braille% Building viewer read model: 5/5 pages (100%)',
		);
	});

	it('uses the original wording when phase is buildingPages (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 50, totalRows: 100 },
				'buildingPages',
			),
		).toBe('%braille% Building viewer read model: 50/100 pages (50%)');
	});

	it('labels creatingIndexes progress with an "indexes" unit (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 23, totalRows: 57 },
				'creatingIndexes',
			),
		).toBe('%braille% Creating indexes: 23/57 indexes (40%)');
	});

	it('labels buildingAnchorFacts progress with an "id ranges" unit (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 224_000, totalRows: 451_641 },
				'buildingAnchorFacts',
			),
		).toBe('%braille% Building anchor facts: 224,000/451,641 id ranges (49%)');
	});

	it('labels computingSummary progress with a "steps" unit (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 1, totalRows: 3 },
				'computingSummary',
			),
		).toBe('%braille% Computing summary: 1/3 steps (33%)');
	});

	it('labels buildingGraph progress with an "edge ids" unit (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 2000, totalRows: 10_000 },
				'buildingGraph',
			),
		).toBe('%braille% Building link graph: 2,000/10,000 edge ids (20%)');
	});

	it('labels buildingMismatches progress with a "scans" unit (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 3, totalRows: 6 },
				'buildingMismatches',
			),
		).toBe('%braille% Building mismatches: 3/6 scans (50%)');
	});

	it('starts with the %braille% spinner placeholder so sparse updates still animate (issue #294)', () => {
		expect(formatViewerReadModelProgress({ insertedRows: 1, totalRows: 2 })).toMatch(
			/^%braille% /,
		);
	});
});
