import type { GetIsolatedClusterOptions, IsolatedClusterDetail } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeIsolatedClusters } from './compute-isolated-clusters.js';

/**
 * Fetch the full member list for a single **孤立集合** identified by its
 * representative URL.
 *
 * The cluster's `representativeUrl` (returned by
 * {@link import('./list-isolated-clusters.js').listIsolatedClusters}) is
 * the lexicographically smallest member — a deterministic, persistent
 * identifier requiring no extra storage. Callers pass the same string back
 * here to drill into the cluster's members.
 *
 * Returns `null` when no cluster with that representative exists in the
 * current archive state. The viewer treats this as "the cluster you were
 * looking at has been re-computed away" (e.g. after `--append` brought a
 * crawled page into one of the cluster members → all of the cluster's
 * inventory-* members got demoted to `'crawled'` and the cluster
 * disappeared).
 *
 * Members are sorted by URL ASC — same order as the embedded `members`
 * array in `computeIsolatedClusters`, ensuring `members[0].url ===
 * representativeUrl` is always true.
 *
 * Read-only — safe against viewer / stub-mode archives.
 * @param accessor - The archive accessor to query.
 * @param representativeUrl - The cluster's representative URL (from `listIsolatedClusters`).
 * @param options - Optional pre-computed components for cache reuse.
 * @returns The cluster detail with all members, or `null` if no such cluster exists.
 */
export async function getIsolatedCluster(
	accessor: ArchiveAccessor,
	representativeUrl: string,
	options: GetIsolatedClusterOptions = {},
): Promise<IsolatedClusterDetail | null> {
	const components =
		options.precomputedComponents ?? (await computeIsolatedClusters(accessor));
	for (const component of components) {
		if (component.representativeUrl !== representativeUrl) {
			continue;
		}
		// Singletons (size 1) belong to `listIsolatedPages`, not the cluster
		// surface. If a follow-up crawl collapsed the cluster to a single
		// remaining inventory-* member, treat the cluster as "gone" so the
		// viewer redirects back to the cluster list instead of showing a
		// misleading size=1 detail pane.
		if (component.size < 2) {
			return null;
		}
		// Strip the internal `id` field from each member: the public DTO
		// does not expose database row ids — consumers identify members
		// by URL, the only stable identifier.
		const members = component.members.map((m) => ({
			url: m.url,
			title: m.title,
			status: m.status,
			source: m.source,
		}));
		return {
			representativeUrl: component.representativeUrl,
			members,
			size: component.size,
		};
	}
	return null;
}
