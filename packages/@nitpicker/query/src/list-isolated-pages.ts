import type { IsolatedPageEntry, ListIsolatedPagesOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeIsolatedClusters } from './compute-isolated-clusters.js';
import { sortArrayItems } from './sort-array-items.js';

/**
 * List **完全孤立** — inventory-* HTML pages that have NO resolved-anchor
 * inbound from any other inventory-* node (singletons in the inventory
 * subgraph).
 *
 * Definition: source-based filter + connectivity check, in that order.
 *
 * - A page must carry `source = 'inventory-seed'` (or `'inventory-discovered'`
 *   technically — but discovered rows always carry the discoverer's anchor
 *   inbound, so they are excluded here in practice). `'crawled'` rows CANNOT
 *   be isolated by definition: the `crawled-wins` downgrade in
 *   `Database.#getIdByUrl` guarantees that any inventory-* page reached
 *   through the crawled chain has been demoted to `'crawled'` already, so
 *   `source = 'crawled'` is an assertive "this page was reached by the
 *   recursive crawl" label. A `'crawled'` orphan would indicate a recording
 *   bug; the source-based filter keeps such bugs out of the default view.
 * - Connectivity: the page must form a singleton (size 1 connected
 *   component) in the **resolved-anchor** inventory-* subgraph computed by
 *   `computeIsolatedClusters`. Anchors that point through a redirect chain
 *   are resolved to their canonical destination before connectivity is
 *   judged — so a seed reached only via a one-hop redirect from another
 *   inventory-* page is treated as cluster-member (not singleton).
 *
 * Compared with the previous link-graph-only filter: `'crawled'` orphans
 * (= recording gaps) no longer surface here, and redirect-source rows are
 * canonical-folded so the "completely alone" judgment matches the user-
 * facing mental model of "URL existed on the server, was not linked from
 * the main archive, and no other inventory page references it either".
 *
 * Read-only — safe against viewer / stub-mode archives.
 *
 * **Performance**: `computeIsolatedClusters` runs a union-find that on
 * a 10 GB inventory archive costs ~20-30 s. When the caller supplies
 * `options.precomputedComponents` (the viewer's per-archive cache
 * does this), the union-find is skipped entirely and the function
 * resolves in milliseconds.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of singleton inventory-* pages with their `source` badge.
 */
export async function listIsolatedPages(
	accessor: ArchiveAccessor,
	options: ListIsolatedPagesOptions = {},
): Promise<{ items: IsolatedPageEntry[]; total: number }> {
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const components =
		options.precomputedComponents ?? (await computeIsolatedClusters(accessor));
	const singletons: IsolatedPageEntry[] = [];
	for (const component of components) {
		if (component.size !== 1) {
			continue;
		}
		const only = component.members[0];
		if (only === undefined) {
			continue;
		}
		singletons.push({
			url: only.url,
			title: only.title,
			status: only.status,
			source: only.source,
		});
	}

	const filtered = singletons.filter((item) => {
		if (
			options.urlPattern &&
			!item.url.includes(options.urlPattern.replaceAll('%', ''))
		) {
			return false;
		}
		if (options.source && item.source !== options.source) {
			return false;
		}
		if (options.status != null && item.status !== options.status) {
			return false;
		}
		return true;
	});
	const sorted = sortArrayItems(filtered, options.sortBy ?? 'url', options.sortOrder, {
		url: { getValue: (item) => item.url, type: 'url' },
		title: { getValue: (item) => item.title },
		status: { getValue: (item) => item.status },
		source: { getValue: (item) => item.source },
	});

	const items = sorted.slice(offset, offset + limit);
	return { items, total: sorted.length };
}
