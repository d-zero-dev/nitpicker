import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

/**
 * Progress unit noun for phases whose `onProgress` reports something other
 * than `viewer_pages` rows (issue #294) — e.g. `creatingIndexes` counts
 * indexes created, `buildingAnchorFacts` counts `content_items.id` ranges
 * scanned. Phases absent here (including `buildingPages`, the original
 * `onProgress` use case) default to `"pages"` in
 * `appendViewerReadModelPhaseRows`.
 */
export const PROGRESS_UNIT_BY_PHASE: Partial<Record<ViewerReadModelBuildPhase, string>> =
	{
		computingSummary: 'steps',
		loadingPageRows: 'ids',
		loadingTechnologyRows: 'ids',
		buildingDirectoryTree: 'rows',
		buildingTechnologySummary: 'rows',
		buildingIsolatedComponents: 'rows',
		buildingAnchorFacts: 'id ranges',
		buildingGraph: 'edge ids',
		buildingResources: 'resource ids',
		buildingImages: 'image ids',
		buildingHeaderChecks: 'rows',
		buildingDuplicateGroups: 'ids',
		buildingMismatches: 'scans',
		creatingIndexes: 'indexes',
	};
