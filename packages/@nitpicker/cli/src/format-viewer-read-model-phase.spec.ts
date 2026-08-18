import { describe, it, expect } from 'vitest';

import { formatViewerReadModelPhase } from './format-viewer-read-model-phase.js';

describe('formatViewerReadModelPhase', () => {
	it('formats a backfill phase with wording matching the standalone viewer-build backfill lines', () => {
		expect(formatViewerReadModelPhase('backfillingBodyHash')).toBe(
			'Backfilling page content hashes',
		);
		expect(formatViewerReadModelPhase('backfillingAliasOfId')).toBe(
			'Backfilling duplicate page links',
		);
		expect(formatViewerReadModelPhase('backfillingDedupeCapEventId')).toBe(
			'Backfilling dedupe-cap markers',
		);
	});

	it('formats a build phase', () => {
		expect(formatViewerReadModelPhase('buildingAnchorFacts')).toBe(
			'Building anchor facts',
		);
	});

	it('formats the final phase', () => {
		expect(formatViewerReadModelPhase('creatingIndexes')).toBe('Creating indexes');
	});

	it('renders no animation placeholder (issue #294) — the TaskList row icon animates instead', () => {
		expect(formatViewerReadModelPhase('computingSummary')).not.toMatch(
			/%dots%|%braille%/,
		);
	});
});
