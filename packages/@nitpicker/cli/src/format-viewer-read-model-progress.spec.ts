import { describe, it, expect } from 'vitest';

import { formatViewerReadModelProgress } from './format-viewer-read-model-progress.js';

describe('formatViewerReadModelProgress', () => {
	it('formats insertedRows/totalRows with a percentage, no timestamp', () => {
		expect(formatViewerReadModelProgress({ insertedRows: 50, totalRows: 100 })).toBe(
			'Building viewer read model: 50/100 pages (50%)',
		);
	});

	it('formats a completed build (insertedRows === totalRows)', () => {
		expect(formatViewerReadModelProgress({ insertedRows: 5, totalRows: 5 })).toBe(
			'Building viewer read model: 5/5 pages (100%)',
		);
	});

	it('uses the original wording when phase is buildingPages (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 50, totalRows: 100 },
				'buildingPages',
			),
		).toBe('Building viewer read model: 50/100 pages (50%)');
	});

	it('labels creatingIndexes progress with an "indexes" unit (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 23, totalRows: 57 },
				'creatingIndexes',
			),
		).toBe('Creating indexes: 23/57 indexes (40%)');
	});

	it('labels buildingAnchorFacts progress with an "id ranges" unit (issue #294)', () => {
		expect(
			formatViewerReadModelProgress(
				{ insertedRows: 224_000, totalRows: 451_641 },
				'buildingAnchorFacts',
			),
		).toBe('Building anchor facts: 224,000/451,641 id ranges (49%)');
	});
});
