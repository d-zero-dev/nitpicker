import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

/**
 * Ordered phase sequence `buildViewerReadModel`/`buildViewerReadModelInWorker`
 * announce via `onPhase`, unconditionally and always in this order (see
 * `build-viewer-read-model.ts`'s source — no branches gate which phases
 * fire). Single source of truth for the row order
 * `appendViewerReadModelPhaseRows` pre-builds when a full rebuild runs
 * (issue #294).
 */
export const VIEWER_READ_MODEL_FULL_BUILD_PHASES: readonly ViewerReadModelBuildPhase[] = [
	'backfillingAnalysisViolations',
	'backfillingBodyHash',
	'backfillingAliasOfId',
	'backfillingDedupeCapEventId',
	'computingSummary',
	'loadingPageRows',
	'loadingTechnologyRows',
	'buildingAnchorFacts',
	'buildingPages',
	'buildingDirectoryTree',
	'buildingTechnologySummary',
	'buildingIsolatedComponents',
	'buildingGraph',
	'buildingResources',
	'buildingImages',
	'buildingHeaderChecks',
	'buildingDuplicateGroups',
	'buildingMismatches',
	'creatingIndexes',
	'committing',
	'checkpointing',
];
