import type { IsolatedClusterSummary, ListIsolatedClustersOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeIsolatedClusters } from './compute-isolated-clusters.js';
import { sortArrayItems } from './sort-array-items.js';

/**
 * List **孤立集合** — connected components of the inventory-* subgraph with
 * size ≥ 2.
 *
 * Each summary row identifies one cluster by its `representativeUrl` (the
 * lexicographically smallest member URL) and reports `size` plus the
 * representative member's title/status so the viewer can render a useful
 * table row without having to fetch every member. The caller follows up
 * with {@link import('./get-isolated-cluster.js').getIsolatedCluster} to
 * pull the full member list for a specific cluster.
 *
 * Singletons (size 1 — **完全孤立**) are reported separately by
 * {@link import('./list-isolated-pages.js').listIsolatedPages}; cluster
 * listing intentionally omits them so the operator sees "interconnected
 * orphan groups" without the singleton noise that swamps a typical
 * inventory dump.
 *
 * Sort: `size DESC, representativeUrl ASC`. Largest clusters lead — they
 * are the audit operator's first interest (a 50-page archive index
 * dropped from the main nav vs a 2-page disconnected pair).
 *
 * Read-only — safe against viewer / stub-mode archives.
 *
 * **Performance**: shares the `computeIsolatedClusters` cost with
 * `listIsolatedPages` / `getIsolatedCluster`. Pass
 * `options.precomputedComponents` to skip the union-find; the viewer's
 * per-archive cache supplies this so all three isolated-* endpoints
 * pay the cost once per archive instead of per endpoint hit.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated cluster summaries with their representative URL and size.
 */
export async function listIsolatedClusters(
	accessor: ArchiveAccessor,
	options: ListIsolatedClustersOptions = {},
): Promise<{ items: IsolatedClusterSummary[]; total: number }> {
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const components =
		options.precomputedComponents ?? (await computeIsolatedClusters(accessor));
	const clusters: IsolatedClusterSummary[] = [];
	for (const component of components) {
		if (component.size < 2) {
			continue;
		}
		const representative = component.members[0];
		if (representative === undefined) {
			continue;
		}
		clusters.push({
			representativeUrl: component.representativeUrl,
			representativeTitle: representative.title,
			representativeStatus: representative.status,
			size: component.size,
		});
	}

	const filtered = clusters.filter((item) => {
		if (
			options.urlPattern &&
			!item.representativeUrl.includes(options.urlPattern.replaceAll('%', ''))
		) {
			return false;
		}
		if (options.status != null && item.representativeStatus !== options.status) {
			return false;
		}
		return true;
	});
	const sorted = sortArrayItems(
		filtered,
		options.sortBy ?? 'size',
		options.sortOrder ?? 'desc',
		{
			representativeUrl: {
				getValue: (item) => item.representativeUrl,
				type: 'url',
			},
			representativeTitle: { getValue: (item) => item.representativeTitle },
			representativeStatus: { getValue: (item) => item.representativeStatus },
			size: { getValue: (item) => item.size },
		},
	);

	const items = sorted.slice(offset, offset + limit);
	return { items, total: sorted.length };
}
