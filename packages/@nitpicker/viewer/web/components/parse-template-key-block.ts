import type { ClusterBlockKind, ClusterBlockRef } from '../types.js';

const KIND_BY_PREFIX: ReadonlyMap<string, ClusterBlockKind> = new Map([
	['css', 'css'],
	['path', 'path'],
	['orphan-merge', 'orphanMerge'],
]);

/**
 * Extracts the `@d-zero/page-cluster` Pass-0 block key out of a
 * `page_templates.template_key`.
 *
 * A template key is the JSON array `["<blockKey>","cluster:<n>"]` — the
 * block the cluster was split out of, then its index within that block.
 * Reading the block key back out of the template key (rather than from
 * `reason.blocking[].blockKey`) means a cluster whose `reason` was never
 * captured still lands in its block.
 *
 * The kind comes from the block key's prefix: `css:` / `path:` /
 * `orphan-merge:` (the `REASSIGNED_KEY_PREFIX` orphan-merge rewrite uses).
 * Any other prefix yields `unknown` rather than throwing, so a block kind
 * introduced upstream still groups correctly in an older viewer build.
 * @param templateKey - The raw template key.
 * @returns The block ref, or `null` when `templateKey` is not a JSON array
 *   whose first element is a non-empty string — the caller treats such a
 *   cluster as a block of its own.
 * @example
 * ```ts
 * parseTemplateKeyBlock('["css:166e4235afcb8b15","cluster:0"]');
 * // => { blockKey: 'css:166e4235afcb8b15', kind: 'css' }
 * ```
 */
export function parseTemplateKeyBlock(templateKey: string): ClusterBlockRef | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(templateKey);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) {
		return null;
	}
	const blockKey = parsed[0];
	if (typeof blockKey !== 'string' || blockKey === '') {
		return null;
	}
	const separator = blockKey.indexOf(':');
	const prefix = separator === -1 ? '' : blockKey.slice(0, separator);
	return { blockKey, kind: KIND_BY_PREFIX.get(prefix) ?? 'unknown' };
}
