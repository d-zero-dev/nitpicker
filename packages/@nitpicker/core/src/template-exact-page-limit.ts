import { nativeBinding } from './native-binding.js';

/**
 * Pages of blocks clustered whole a template classification run (see
 * `createTemplateClassificationRun`) holds at once, at most. Clustering a
 * block needs every page's parsed markup until its block is done, about
 * 60 KB a page, so this bounds that memory whatever the corpus size. When
 * the blocks clustered whole would hold more, the largest blocks of more
 * than `TEMPLATE_BLOCK_SAMPLE_SIZE` pages are clustered from a sample
 * instead (most pages first) until the rest fits; a block of at most that
 * many pages frees nothing by being sampled, so none is left out for this
 * limit. Fixed, not a setting: which blocks are sampled decides their
 * stored keys. Read from the addon, so a caller documenting or sizing by
 * it cannot drift from what the run actually does.
 * @example
 * ```ts
 * const heldPages = Math.min(wholeBlockPageCount, TEMPLATE_EXACT_PAGE_LIMIT);
 * ```
 */
export const TEMPLATE_EXACT_PAGE_LIMIT: number = nativeBinding.TEMPLATE_EXACT_PAGE_LIMIT;
