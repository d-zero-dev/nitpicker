import type { TemplateClusterSummary } from '@nitpicker/query';

/**
 * Pages not covered by any of the top directories `computeDirectoryDistribution`
 * returned — the count a viewer needs to know the top-N list isn't silently
 * dropping members, without the backend having to send every long-tail
 * directory over the wire.
 * @param cluster - The template cluster whose directory coverage to check.
 * @returns The number of member pages outside `cluster.commonDirectories`.
 * @example
 * ```ts
 * computeClusterOtherPageCount(cluster); // => 3
 * ```
 */
export function computeClusterOtherPageCount(cluster: TemplateClusterSummary): number {
	const topCount = cluster.commonDirectories.reduce(
		(sum, entry) => sum + entry.pageCount,
		0,
	);
	return cluster.pageCount - topCount;
}
