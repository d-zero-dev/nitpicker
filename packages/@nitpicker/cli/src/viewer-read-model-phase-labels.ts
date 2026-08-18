import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

/**
 * Human-readable label for each {@link ViewerReadModelBuildPhase} — shared by
 * `format-viewer-read-model-phase.ts` (the phase-change line) and
 * `format-viewer-read-model-progress.ts` (which prefixes a progress line
 * with the current phase's label once a phase reports sub-progress, e.g.
 * `Creating indexes: 23/57`) so the two can't drift into inconsistent
 * wording for the same phase (issue #294).
 *
 * Wording for the three backfill phases intentionally matches `viewer-build`
 * command's own standalone backfill progress lines (`Backfilling page
 * content hashes`, etc.) — same underlying operation, same name, whether it
 * runs nested inside `buildViewerReadModel` or as its own explicit step.
 */
export const VIEWER_READ_MODEL_PHASE_LABELS: Record<ViewerReadModelBuildPhase, string> = {
	backfillingAnalysisViolations: 'Backfilling analysis violations',
	backfillingBodyHash: 'Backfilling page content hashes',
	backfillingAliasOfId: 'Backfilling duplicate page links',
	backfillingDedupeCapEventId: 'Backfilling dedupe-cap markers',
	computingSummary: 'Computing summary',
	buildingPages: 'Building pages',
	buildingDirectoryTree: 'Building directory tree',
	buildingTechnologySummary: 'Building technology summary',
	buildingIsolatedComponents: 'Building isolated components',
	buildingAnchorFacts: 'Building anchor facts',
	buildingGraph: 'Building link graph',
	buildingResources: 'Building resources',
	buildingImages: 'Building images',
	buildingHeaderChecks: 'Building header checks',
	buildingDuplicateGroups: 'Building duplicate groups',
	buildingMismatches: 'Building mismatches',
	creatingIndexes: 'Creating indexes',
};
