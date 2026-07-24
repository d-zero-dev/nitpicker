/**
 * Computes the set of stylesheet URLs common to every page in a template
 * cluster.
 *
 * **Deliberately simplified relative to how `@d-zero/page-cluster` actually
 * derives a `css:<hash>` template key.** That library first drops stylesheet
 * hrefs referenced by 90%+ of a homogeneous page corpus (site-wide chrome
 * like a shared reset/font stylesheet — see its internal
 * `computeDocumentFrequency`/`splitTokensByFrequency`) and restricts to
 * first-party hosts (`filterFirstPartyStylesheetHrefs`) before hashing what's
 * left. Those three functions are internal to `@d-zero/page-cluster` — not
 * published in its package.json `exports` — so this function does not
 * reproduce them. The result here is a **raw intersection**: a stylesheet
 * loaded by every page in the cluster *and* by most other pages on the site
 * (e.g. a shared `common.css`) still shows up as "common to this cluster",
 * which is not the same claim `css:<hash>` is actually making. If
 * `@d-zero/page-cluster` ever publishes that filtering as a public API,
 * revisit this function to use it instead.
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
