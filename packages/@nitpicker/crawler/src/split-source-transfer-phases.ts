import type { TransferPhase } from './archive/transfer/types.js';

/**
 * Ordered phase sequence {@link import('./archive/transfer/transfer-archive-rows.js').transferArchiveRows}
 * announces via `onPhase` for split's single source — identical to
 * {@link import('./concat-source-transfer-phases.js').CONCAT_SOURCE_TRANSFER_PHASES}
 * (the phase sequence inside `transferArchiveRows` does not branch on
 * mode, only what each phase DOES differs), kept as its own named export
 * so a CLI caller building split's `TaskList` rows never has to reason
 * about why it is importing something named "concat".
 */
export const SPLIT_SOURCE_TRANSFER_PHASES: readonly TransferPhase[] = [
	'planningContentItems',
	'copyingDictionaries',
	'copyingContentItems',
	'copyingPageRows',
	'copyingResources',
	'copyingJournals',
	'committing',
];
