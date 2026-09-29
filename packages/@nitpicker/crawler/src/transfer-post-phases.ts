import type { TransferPhase } from './archive/transfer/types.js';

/**
 * Ordered whole-operation phase sequence `concatArchives`/`splitArchive`
 * announce (via `sourceIndex === sources.length`) once every source has
 * been transferred: `flattenRedirectChains` → `reclassifyResourceExternality`
 * → `countExternalPagesInScope`. Identical for both commands — split's
 * single source is already flat and its scope only shrinks, so the first
 * two are cheap no-ops there, but the sequence itself does not branch.
 */
export const TRANSFER_POST_PHASES: readonly TransferPhase[] = [
	'flatteningRedirects',
	'reclassifyingResources',
	'countingExternalInScope',
];
