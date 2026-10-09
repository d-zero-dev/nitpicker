import type { TransferPhase } from './types.js';

/**
 * Ordered phase sequence {@link import('./transfer-archive-rows.js').transferArchiveRows}
 * announces via `onPhase`, once per concat source, unconditionally and
 * always in this order (see that function's own source — no branch skips
 * a phase). Single source of truth for the per-source `TaskList` rows a
 * CLI caller pre-builds (mirrors `VIEWER_READ_MODEL_FULL_BUILD_PHASES`'s
 * same role for the read-model build).
 */
export const CONCAT_SOURCE_TRANSFER_PHASES: readonly TransferPhase[] = [
	'planningContentItems',
	'copyingDictionaries',
	'copyingContentItems',
	'copyingPageRows',
	'copyingResources',
	'copyingJournals',
	'committing',
];
