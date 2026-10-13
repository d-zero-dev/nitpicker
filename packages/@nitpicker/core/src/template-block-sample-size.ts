import { nativeBinding } from './native-binding.js';

/**
 * Pages per block a streaming template classification run clusters (see
 * `createTemplateClassificationRun`); every other page of a larger block is
 * assigned to the nearest of those clusters, and the merge across blocks
 * keeps at most this many members per cluster. Read from the addon,
 * so a caller sizing its own work by the sample cannot drift from what the
 * run actually keeps.
 * @example
 * ```ts
 * const sampledPages = Math.min(blockPageCount, TEMPLATE_BLOCK_SAMPLE_SIZE);
 * ```
 */
export const TEMPLATE_BLOCK_SAMPLE_SIZE: number =
	nativeBinding.TEMPLATE_BLOCK_SAMPLE_SIZE;
