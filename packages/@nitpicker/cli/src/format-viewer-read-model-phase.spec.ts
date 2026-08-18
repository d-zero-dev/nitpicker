import { describe, it, expect } from 'vitest';

import { formatViewerReadModelPhase } from './format-viewer-read-model-phase.js';

describe('formatViewerReadModelPhase', () => {
	it('formats a backfill phase with wording matching the standalone viewer-build backfill lines', () => {
		expect(formatViewerReadModelPhase('backfillingBodyHash')).toBe(
			'Backfilling page content hashes%dots%',
		);
		expect(formatViewerReadModelPhase('backfillingAliasOfId')).toBe(
			'Backfilling duplicate page links%dots%',
		);
		expect(formatViewerReadModelPhase('backfillingDedupeCapEventId')).toBe(
			'Backfilling dedupe-cap markers%dots%',
		);
	});

	it('formats a build phase', () => {
		expect(formatViewerReadModelPhase('buildingAnchorFacts')).toBe(
			'Building anchor facts%dots%',
		);
	});

	it('formats the final phase', () => {
		expect(formatViewerReadModelPhase('creatingIndexes')).toBe('Creating indexes%dots%');
	});

	it('ends with the %dots% Lanes animation placeholder (issue #294) so a phase with no sub-progress still animates', () => {
		expect(formatViewerReadModelPhase('computingSummary')).toMatch(/%dots%$/);
	});
});
