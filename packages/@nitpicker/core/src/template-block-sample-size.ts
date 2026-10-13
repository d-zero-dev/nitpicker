import { nativeBinding } from './native-binding.js';

/**
 * Pages per block a streaming template classification run clusters (see
 * `createTemplateStageARun`); every other page of a larger block is
 * assigned to the nearest of those clusters. Read from the addon, so a
 * caller sizing its own work by the sample (Stage B caps merged groups at
 * it) cannot drift from what the run actually keeps.
 * @example
 * ```ts
 * mergeCrossBlockClusters(units, { capMembers: TEMPLATE_BLOCK_SAMPLE_SIZE });
 * ```
 */
export const TEMPLATE_BLOCK_SAMPLE_SIZE: number =
	nativeBinding.TEMPLATE_BLOCK_SAMPLE_SIZE;
