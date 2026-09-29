import type { TransferPhase } from '@nitpicker/crawler';

/**
 * Human-readable label for each {@link TransferPhase} — one `@d-zero/dealer`
 * `TaskList` row per phase, following the same "fully expand every phase
 * into its own row" convention as `VIEWER_READ_MODEL_PHASE_LABELS`.
 */
export const TRANSFER_PHASE_LABELS: Record<TransferPhase, string> = {
	planningContentItems: 'Planning pages',
	copyingDictionaries: 'Copying dictionaries',
	copyingContentItems: 'Copying pages',
	copyingPageRows: 'Copying page data',
	copyingResources: 'Copying resources',
	copyingJournals: 'Copying crawl history',
	committing: 'Committing',
	flatteningRedirects: 'Flattening redirect chains',
	reclassifyingResources: 'Reclassifying resource scope',
	countingExternalInScope: 'Counting in-scope external pages',
};
