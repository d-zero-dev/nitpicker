import { nativeBinding } from './native-binding.js';

/**
 * Corpus size at or below which a template classification run (see
 * `createTemplateClassificationRun`) keeps every page and judges landmark
 * chrome across the whole corpus; above it the run streams, clustering a
 * sample per block and assigning the rest in a second read. Which side a
 * corpus falls on decides its stored keys. Read from the addon, so a caller
 * labeling or sizing its work by the path cannot drift from what the run
 * actually does.
 * @example
 * ```ts
 * const path = pageCount > TEMPLATE_CORPUS_INLINE_THRESHOLD ? 'streaming' : 'in-memory';
 * ```
 */
export const TEMPLATE_CORPUS_INLINE_THRESHOLD: number =
	nativeBinding.TEMPLATE_CORPUS_INLINE_THRESHOLD;
