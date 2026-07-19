import { describe, it, expect } from 'vitest';

import { formatViewerReadModelProgress } from './format-viewer-read-model-progress.js';

describe('formatViewerReadModelProgress', () => {
	it('formats insertedRows/totalRows into a single stderr line', () => {
		expect(formatViewerReadModelProgress({ insertedRows: 50, totalRows: 100 })).toBe(
			'[nitpicker] building viewer read model: 50/100 pages',
		);
	});

	it('formats a completed build (insertedRows === totalRows)', () => {
		expect(formatViewerReadModelProgress({ insertedRows: 5, totalRows: 5 })).toBe(
			'[nitpicker] building viewer read model: 5/5 pages',
		);
	});
});
