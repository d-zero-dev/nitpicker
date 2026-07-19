import type { IsolatedComponent } from '../types.js';
import type {
	IsolatedComponentInsertRow,
	IsolatedComponentPageInsertRow,
} from './types.js';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/**
 * Converts `computeIsolatedClusters()` output into insert rows for
 * `viewer_isolated_components` and `viewer_isolated_component_pages`.
 *
 * Uses `pageIdByUrl` rather than relying on `computeIsolatedClusters()`'s
 * internal temporary `id` field: the public `IsolatedComponent` DTO is
 * intentionally URL-addressed, so the read-model build reconstructs the page
 * ids from the already-loaded canonical `pages` snapshot (`sourceRows`) to
 * keep the boundary explicit.
 * @param components - Precomputed isolated components.
 * @param pageIdByUrl - Lookup from canonical page URL to `pages.id`.
 * @returns Insert rows for both isolated-component tables.
 */
export function buildIsolatedReadModelRows(
	components: readonly IsolatedComponent[],
	pageIdByUrl: ReadonlyMap<string, number>,
): {
	components: IsolatedComponentInsertRow[];
	pages: IsolatedComponentPageInsertRow[];
} {
	const componentRows: IsolatedComponentInsertRow[] = [];
	const pageRows: IsolatedComponentPageInsertRow[] = [];

	for (const [index, component] of components.entries()) {
		const representative = component.members[0];
		if (representative === undefined) {
			continue;
		}

		const componentId = index + 1;
		const representativeStatusSortKey = representative.status ?? NULL_STATUS_SENTINEL;
		componentRows.push({
			component_id: componentId,
			representative_url: component.representativeUrl,
			representative_title: representative.title,
			representative_status: representative.status,
			representative_url_sort_key: component.representativeUrl,
			representative_title_sort_key: representative.title ?? '',
			representative_status_sort_key: representativeStatusSortKey,
			representative_status_desc_key: -representativeStatusSortKey,
			size: component.size,
			size_desc_key: -component.size,
		});

		for (const member of component.members) {
			const pageId = pageIdByUrl.get(member.url);
			if (pageId === undefined) {
				continue;
			}
			const statusSortKey = member.status ?? NULL_STATUS_SENTINEL;
			pageRows.push({
				component_id: componentId,
				page_id: pageId,
				url: member.url,
				title: member.title,
				status: member.status,
				source: member.source,
				url_sort_key: member.url,
				title_sort_key: member.title ?? '',
				status_sort_key: statusSortKey,
				status_desc_key: -statusSortKey,
			});
		}
	}

	return { components: componentRows, pages: pageRows };
}
