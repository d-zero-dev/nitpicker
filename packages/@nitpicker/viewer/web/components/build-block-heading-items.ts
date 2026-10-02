import type { ClusterBlockGroup } from '../types.js';

/**
 * Builds the human-readable detail text for one block group's heading —
 * the part after the kind label, since the block key itself is opaque for
 * `css:` blocks (a SHA-256 prefix) and only barely readable for the others.
 *
 * - `css`: the union of every member cluster's
 *   `reason.distinctiveStylesheetFileNames` (the exact stylesheet set the
 *   block was keyed on), falling back to the union of
 *   `commonStylesheetFileNames` when no member captured a reason.
 * - `path` / `orphanMerge`: the path segment after the prefix, rendered as
 *   `/<segment>/` (`/` for the empty site-root segment).
 * - anything else, or a css block with no stylesheet names at all: the
 *   largest member's top directory, else the raw block key.
 *
 * Filenames are deduplicated and sorted so two blocks keyed on the same set
 * in a different order read identically.
 * @param group - The block group to build a heading for.
 * @returns The heading detail items — each a literal (file name or path) to show verbatim.
 * @example
 * ```ts
 * buildBlockHeadingItems(group); // ['product.css', 'slick.css']
 * ```
 */
export function buildBlockHeadingItems(group: ClusterBlockGroup): string[] {
	const { block, clusters } = group;
	if (block.kind === 'path' || block.kind === 'orphanMerge') {
		const segment = block.blockKey.slice(block.blockKey.indexOf(':') + 1);
		return [segment === '' ? '/' : `/${segment}/`];
	}
	if (block.kind === 'css') {
		const distinctive = collectNames(
			clusters.map((c) => c.reason?.distinctiveStylesheetFileNames),
		);
		if (distinctive.length > 0) {
			return distinctive;
		}
		const common = collectNames(clusters.map((c) => c.commonStylesheetFileNames));
		if (common.length > 0) {
			return common;
		}
	}
	const topDirectory = clusters[0]?.commonDirectories[0]?.directory;
	return [topDirectory ?? block.blockKey];
}

/**
 * Unions the given name lists into one deduplicated, sorted list.
 * @param lists - Name lists to merge; `undefined` entries are skipped.
 * @returns The distinct names, sorted.
 */
function collectNames(lists: readonly (readonly string[] | undefined)[]): string[] {
	const names = new Set<string>();
	for (const list of lists) {
		for (const name of list ?? []) {
			names.add(name);
		}
	}
	return [...names].toSorted();
}
