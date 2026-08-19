import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

/**
 * Human-readable label for each {@link ViewerReadModelBuildPhase} — one
 * `@d-zero/dealer` `TaskList` row per phase (issue #294: each phase is fully
 * expanded into its own row via {@link appendViewerReadModelPhaseRows} rather
 * than collapsed into a single text-swapping row).
 *
 * Wording for the three backfill phases intentionally matches `viewer-build`
 * command's own standalone backfill progress lines (`Backfilling page
 * content hashes`, etc.) — same underlying operation, same name, whether it
 * runs nested inside `buildViewerReadModel` or as its own explicit step.
 *
 * `checkpointing`'s label is deliberately `'Checkpointing read model'`, not
 * `'Checkpointing database'` (`WRITE_STEP_LABELS.checkpoint`'s wording) —
 * both run the same `PRAGMA wal_checkpoint(TRUNCATE)`, but on unrelated rows
 * (a read-model build's own WAL fold-back vs. `archive.write()`'s pre-tar
 * checkpoint); a shared label would make the two rows indistinguishable once
 * each phase renders on its own line.
 */
export const VIEWER_READ_MODEL_PHASE_LABELS: Record<ViewerReadModelBuildPhase, string> = {
	backfillingAnalysisViolations: 'Backfilling analysis violations',
	backfillingBodyHash: 'Backfilling page content hashes',
	backfillingAliasOfId: 'Backfilling duplicate page links',
	backfillingDedupeCapEventId: 'Backfilling dedupe-cap markers',
	computingSummary: 'Computing summary',
	loadingPageRows: 'Loading page rows',
	loadingTechnologyRows: 'Loading technology rows',
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
	committing: 'Committing read model',
	checkpointing: 'Checkpointing read model',
};
