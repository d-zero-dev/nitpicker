import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns the precomputed size of an isolated component, identified by its
 * representative URL, or `null` when no such component exists.
 * @param accessor - Archive accessor whose read model is current.
 * @param representativeUrl - Component identifier, as returned by
 *   `listViewerIsolatedClusters`.
 * @returns The component's member count, or `null` when no component has
 *   the given representative URL.
 * @example
 * const size = await getViewerIsolatedComponentSize(
 *   accessor,
 *   'https://example.com/orphan/',
 * );
 */
export async function getViewerIsolatedComponentSize(
	accessor: ArchiveAccessor,
	representativeUrl: string,
): Promise<number | null> {
	const row = await accessor
		.getKnex()('viewer_isolated_components')
		.where('representative_url', representativeUrl)
		.first('size');
	return row ? Number(row.size) : null;
}
