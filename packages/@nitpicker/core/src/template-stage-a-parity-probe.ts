import type { ContentRootHint } from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Exposes what the native Stage A derives from one page — parser events,
 * tokens, landmarks, the content root and the tokens at each content depth
 * (by event replay and by re-parsing) — as JSON with byte offsets, for the
 * parity tests against the JavaScript engine it replaces.
 * @param html - The page.
 * @param contentRoot - The crawler's content-root hint.
 * @returns The JSON record.
 * @example
 * ```ts
 * JSON.parse(templateStageAParityProbe('<body><p>x</p></body>')).tokens; // ['body>p']
 * ```
 */
export function templateStageAParityProbe(
	html: string,
	contentRoot?: ContentRootHint,
): string {
	return nativeBinding.templateStageAParityProbe(html, contentRoot);
}
