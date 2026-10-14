import type { PageClusterPage, PageFactory } from './page-cluster/types.js';
import type { CreatePageClusterFactoryOptions } from './types.js';

/**
 * Builds the `PageFactory` that page-cluster's `resolvePageClusterKeys`
 * reads the corpus through, and the URLs of the pages it yields, in order.
 *
 * It yields exactly the candidates it is given — internal HTML pages with a
 * non-empty stored HTML snapshot, decided upfront by
 * `loadPageClusterCandidates` from `collectPageIdsWithHtml` (one query that
 * decompresses nothing). So the set is fixed before the first read and
 * identical on every read, as the engine requires, and each page's HTML is
 * decompressed only on the reads that use it (`getHtml`, by page id) instead
 * of on every read just to see whether it is empty.
 *
 * Each yielded page carries its `paths`, `stylesheetHrefs`, `host`, and —
 * when the crawler detected a main-content element for it — the `contentRoot`
 * hint the candidate holds, which the classifier anchors its content-depth
 * cap on. The factory holds each page's id and these signals only.
 * @param options - See {@link CreatePageClusterFactoryOptions}.
 * @returns `factory` to pass to `resolvePageClusterKeys`, and `urls`: the
 *   yielded pages' `href`, in the order of the keys it returns.
 * @example
 * ```ts
 * const { factory, urls } = createPageClusterFactory({
 * 	archive,
 * 	candidates,
 * 	stylesheetsByUrl,
 * });
 * const { keys } = await resolvePageClusterKeys(factory);
 * // keys[i] is the template key of urls[i]
 * ```
 */
export function createPageClusterFactory(options: CreatePageClusterFactoryOptions): {
	factory: PageFactory;
	urls: readonly string[];
} {
	const { archive, candidates, stylesheetsByUrl } = options;
	const corpus: PageClusterPage[] = candidates.map((candidate) => ({
		paths: candidate.paths,
		stylesheetHrefs: stylesheetsByUrl.get(candidate.href) ?? [],
		host: candidate.host,
		...(candidate.contentRoot ? { contentRoot: candidate.contentRoot } : {}),
		getHtml: async () => {
			const html = await archive.getHtmlOfPage(candidate.id);
			if (!html) {
				// The archive does not change during a classification, so a
				// page found with HTML upfront always reads back with it.
				throw new Error(
					`createPageClusterFactory: ${candidate.href} has no stored HTML, but collectPageIdsWithHtml listed it`,
				);
			}
			return html;
		},
	}));
	return {
		factory: () => corpus,
		urls: candidates.map((candidate) => candidate.href),
	};
}
