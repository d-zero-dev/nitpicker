import type { PageClusterPage, PageFactory } from './page-cluster/types.js';
import type { CreatePageClusterFactoryOptions } from './types.js';

import { createContentRootHint } from './create-content-root-hint.js';

/**
 * Builds the `PageFactory` that page-cluster's `resolvePageClusterKeys`
 * reads the corpus through, and the URLs of the pages it yields, in order.
 *
 * Only internal HTML pages (`Page.isInternalPage()` — content-type based,
 * matching the "a page is judged by content-type, not `isTarget`" archive
 * invariant) with a non-empty stored HTML snapshot are yielded. Which pages
 * have one is decided upfront, from `pageIdsWithHtml`
 * (`collectPageIdsWithHtml`, one query that decompresses nothing), so the
 * set is fixed before the first read and identical on every read, as the
 * engine requires, and each page's HTML is decompressed only on the reads
 * that use it (`getHtml`) instead of on every read just to see whether it
 * is empty.
 *
 * Each yielded page carries its `paths`, `stylesheetHrefs`, `host`, and —
 * when the crawler detected a main-content element for it — a `contentRoot`
 * hint (see {@link createContentRootHint}) that the classifier anchors its
 * content-depth cap on.
 * @param options - See {@link CreatePageClusterFactoryOptions}.
 * @returns `factory` to pass to `resolvePageClusterKeys`, and `urls`: the
 *   yielded pages' `page.url.href`, in the order of the keys it returns.
 * @example
 * ```ts
 * const { factory, urls } = createPageClusterFactory({ pages, stylesheetsByUrl, pageIdsWithHtml });
 * const { keys } = await resolvePageClusterKeys(factory);
 * // keys[i] is the template key of urls[i]
 * ```
 */
export function createPageClusterFactory(options: CreatePageClusterFactoryOptions): {
	factory: PageFactory;
	urls: readonly string[];
} {
	const { stylesheetsByUrl, pageIdsWithHtml } = options;
	const candidates = options.pages.filter(
		(page) => page.isInternalPage() && pageIdsWithHtml.has(page.id),
	);
	const corpus: PageClusterPage[] = candidates.map((page) => {
		const url = page.url;
		const contentRoot = createContentRootHint(page);
		return {
			paths: url.paths,
			stylesheetHrefs: stylesheetsByUrl.get(url.href) ?? [],
			host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
			// Left off entirely (not `undefined`) for pages with no detected
			// main content, so the page carries no undefined-valued key.
			...(contentRoot ? { contentRoot } : {}),
			getHtml: async () => {
				const html = await page.getHtml();
				if (!html) {
					// The archive does not change during a classification, so a
					// page found with HTML upfront always reads back with it.
					throw new Error(
						`createPageClusterFactory: ${url.href} has no stored HTML, but collectPageIdsWithHtml listed it`,
					);
				}
				return html;
			},
		};
	});
	return {
		factory: () => corpus,
		urls: candidates.map((page) => page.url.href),
	};
}
