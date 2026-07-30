/**
 * Computes the set of stylesheet URLs common to every page in a template
 * cluster.
 *
 * **A deliberately simpler, always-available complement to
 * `TemplateClusterSummary.reason.distinctiveStylesheetUrls`, not a
 * reimplementation of it.** `@d-zero/page-cluster` derives a `css:<hash>`
 * template key by first dropping stylesheet hrefs referenced by 90%+ of a
 * homogeneous page corpus (site-wide chrome like a shared reset/font
 * stylesheet) and restricting to first-party hosts before hashing what's
 * left — that filtered result is what `distinctiveStylesheetUrls` reports
 * (via `ClusterReason.blocking[].reason.distinctiveStylesheetHrefs`, public
 * since `@d-zero/page-cluster@0.5.2`'s `build-cluster-reason` export). This
 * function instead computes a **raw intersection**: a stylesheet loaded by
 * every page in the cluster *and* by most other pages on the site (e.g. a
 * shared `common.css`) still shows up as "common to this cluster", which is
 * not the same claim `distinctiveStylesheetUrls` makes. The two remain
 * separate metrics rather than one replacing the other because
 * `distinctiveStylesheetUrls` is unavailable whenever
 * `TemplateClusterSummary.reason` is `null` (a pre-cluster-reason archive,
 * a read-only connection, or a cluster `@d-zero/page-cluster` didn't emit a
 * reason for) and is undefined for `kind:'path'`/`kind:'orphanMerge'`
 * clusters (no CSS blocking involved at all) — this function has neither
 * limitation, since it derives its answer directly from the cluster's
 * member pages rather than from stored evidence.
 * @param cssUrlsByPage - Each page's stylesheet URL list, one entry per page
 *   in the cluster.
 * @returns Stylesheet URLs present in every page's list, sorted. Empty if
 *   `cssUrlsByPage` is empty or any page has no stylesheets at all (an
 *   absent stylesheet reference is treated as an absence of evidence, not a
 *   genuine intersection member).
 * @example
 * ```ts
 * computeCssIntersection([
 *   ['https://example.com/a.css', 'https://example.com/shared.css'],
 *   ['https://example.com/a.css', 'https://example.com/shared.css'],
 * ]);
 * // ['https://example.com/a.css', 'https://example.com/shared.css']
 * ```
 */
export function computeCssIntersection(
	cssUrlsByPage: readonly (readonly string[])[],
): string[] {
	const [first, ...rest] = cssUrlsByPage;
	if (!first || first.length === 0) {
		return [];
	}

	let common = new Set(first);
	for (const urls of rest) {
		if (urls.length === 0) {
			return [];
		}
		const urlSet = new Set(urls);
		common = new Set([...common].filter((url) => urlSet.has(url)));
		if (common.size === 0) {
			return [];
		}
	}

	return [...common].toSorted();
}
