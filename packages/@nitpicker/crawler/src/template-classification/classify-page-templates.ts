import type {
	ClassifyPageTemplatesOptions,
	PageTemplateClassification,
} from './types.js';
import type { TemplateClusterReason } from '../archive/db-ops/templates/types.js';

import { resolvePageClusterKeys } from '@d-zero/page-cluster/resolve-page-cluster-keys';

import { collectPageStylesheetUrls } from './collect-page-stylesheet-urls.js';
import { createPageClusterFactory } from './create-page-cluster-factory.js';

/**
 * Classifies every internal HTML page in the archive into a template group
 * by DOM-structure similarity, using `@d-zero/page-cluster`.
 *
 * The result is deliberately **not cached**. A cache keyed on the archive
 * file's identity (path + size + mtime + page count) cannot be correct at the
 * only point this runs — the end of a crawl, before the archive is written
 * back: `archive.filePath` then still names the previous tar (or nothing), so
 * a `--retry-failed` run that replaces a failed page's HTML without changing
 * the page count would be served the previous classification. A crash during
 * classification leaves the crawl's stub directory in place, and resuming it
 * re-runs this step from scratch; the upstream library has no mid-computation
 * checkpoint to resume from either.
 *
 * Internally: the external library's `resolvePageClusterKeys` returns a
 * `clusterKey` per page; this function's public naming is `templateKey`,
 * to avoid colliding with nitpicker's unrelated pre-existing "isolated
 * cluster" concept (`@nitpicker/query`'s `compute-isolated-clusters.ts`,
 * link-reachability graph components — a completely different kind of
 * grouping from DOM-structure similarity).
 *
 * `onClusterReason` is always passed to `resolvePageClusterKeys` (not made
 * conditional the way `onProgress` is) — as of `@d-zero/page-cluster` 0.5.3,
 * requesting cluster reasons no longer forces small corpora off the
 * progress-emitting path (see that option's own JSDoc), so there is no
 * responsiveness cost to always capturing them.
 * @param options - See {@link ClassifyPageTemplatesOptions}.
 * @returns See {@link PageTemplateClassification}.
 * @example
 * ```ts
 * const pages = await archive.getPages();
 * const { templateKeysByUrl } = await classifyPageTemplates({ archive, pages });
 * await archive.replacePageTemplates(templateKeysByUrl);
 * ```
 */
export async function classifyPageTemplates(
	options: ClassifyPageTemplatesOptions,
): Promise<PageTemplateClassification> {
	const { archive, pages, onProgress } = options;

	onProgress?.({ phase: 'collecting-stylesheets' });
	const stylesheetsByUrl = await collectPageStylesheetUrls(archive);
	const { factory, getYieldedUrls } = createPageClusterFactory(pages, stylesheetsByUrl);

	const clusterReasonsByTemplateKey = new Map<string, TemplateClusterReason>();
	const clusterKeys = await resolvePageClusterKeys(factory, {
		...(onProgress ? { onProgress } : {}),
		onClusterReason: (clusterKey, reason) => {
			clusterReasonsByTemplateKey.set(clusterKey, reason);
		},
	});
	// Safe only after `resolvePageClusterKeys` has resolved — see
	// `createPageClusterFactory`'s JSDoc for why.
	const yieldedUrls = getYieldedUrls();

	if (clusterKeys.length !== yieldedUrls.length) {
		// Would silently mis-map template keys to the wrong URLs if allowed
		// through — see createPageClusterFactory's JSDoc for why this should
		// be structurally impossible, but a loud failure here is far
		// preferable to a quiet mis-assignment. No equivalent check exists for
		// `clusterReasonsByTemplateKey` — see `PageTemplateClassification`'s
		// own JSDoc for why that map is a best-effort side channel, not a
		// per-page guarantee.
		throw new Error(
			`classifyPageTemplates: resolvePageClusterKeys returned ${clusterKeys.length} keys for ${yieldedUrls.length} yielded pages.`,
		);
	}

	const templateKeysByUrl = new Map<string, string>();
	for (const [index, url] of yieldedUrls.entries()) {
		templateKeysByUrl.set(url, clusterKeys[index]!);
	}

	return { templateKeysByUrl, clusterReasonsByTemplateKey };
}
