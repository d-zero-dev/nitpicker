import { nativeBinding } from './native-binding.js';

/**
 * Bytes a block's Stage A similarity table may take before a template
 * classification run (see `createTemplateClassificationRun`) clusters the
 * block from a sample instead of whole. The table is an upper triangle of
 * `f64`, `n * (n - 1) / 2 * 8` bytes for `n` pages and the largest
 * allocation of a run, so this bounds what clustering holds whatever the
 * corpus size. Which blocks fall over it decides their stored keys. Read
 * from the addon, so a caller sizing or documenting the budget cannot drift
 * from what the run actually does.
 * @example
 * ```ts
 * const pairBytes = (pages: number) => (pages * (pages - 1)) / 2 * 8;
 * const sampled = pairBytes(blockPageCount) > TEMPLATE_MEMORY_BUDGET;
 * ```
 */
export const TEMPLATE_MEMORY_BUDGET: number = nativeBinding.TEMPLATE_MEMORY_BUDGET;
