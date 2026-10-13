import type { TemplateClusterReason } from './types.js';

/**
 * Serializes a cluster reason to the JSON text that `page_template_clusters.reason_json`
 * stores (before compression). The single definition of that format:
 * `replacePageTemplates` writes it, and the template-classification golden
 * pins it, so a change here shows up as a golden difference instead of
 * silently diverging from what the golden claims to cover.
 * @param reason - The reason.
 * @returns The JSON text.
 * @example
 * ```ts
 * const json = serializeTemplateClusterReason(reason);
 * const { body } = compressPayload(Buffer.from(json, 'utf8'));
 * ```
 */
export function serializeTemplateClusterReason(reason: TemplateClusterReason): string {
	return JSON.stringify(reason);
}
