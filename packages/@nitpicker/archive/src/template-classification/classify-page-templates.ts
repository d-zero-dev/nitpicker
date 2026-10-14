import type {
	ClassifyPageTemplatesOptions,
	PageTemplateClassification,
} from './types.js';
import type { TemplateClusterReason } from '../db-ops/templates/types.js';

import { collectPageStylesheetUrls } from './collect-page-stylesheet-urls.js';
import { createPageClusterFactory } from './create-page-cluster-factory.js';
import { resolvePageClusterKeys } from './page-cluster/resolve-page-cluster-keys.js';

/**
 * Classifies every internal HTML page in the archive into a template group
 * by DOM-structure similarity, using the classifier `./page-cluster/` drives
 * in `@nitpicker/core`.
 *
 * The result is deliberately **not cached**. A cache keyed on the archive
 * file's identity (path + size + mtime + page count) cannot be correct at the
 * only point this runs — the end of a crawl, before the archive is written
 * back: `archive.filePath` then still names the previous tar (or nothing), so
 * a `--retry-failed` run that replaces a failed page's HTML without changing
 * the page count would be served the previous classification. A crash during
 * classification leaves the crawl's stub directory in place, and resuming it
 * re-runs this step from scratch; the classifier has no mid-computation
 * checkpoint to resume from either.
 *
 * Internally: the driver's `resolvePageClusterKeys` returns a `clusterKey`
 * per page; this function's public naming is `templateKey`, to avoid
 * colliding with nitpicker's unrelated pre-existing "isolated cluster"
 * concept (`@nitpicker/query`'s `compute-isolated-clusters.ts`,
 * link-reachability graph components — a completely different kind of
 * grouping from DOM-structure similarity).
 * @param options - See {@link ClassifyPageTemplatesOptions}.
 * @returns See {@link PageTemplateClassification}.
 * @example
 * ```ts
 * const pageIdsWithHtml = await collectPageIdsWithHtml(archive);
 * const candidates = await loadPageClusterCandidates(archive, { pageIdsWithHtml });
 * const { templateKeysByUrl } = await classifyPageTemplates({ archive, candidates });
 * await archive.replacePageTemplates(templateKeysByUrl);
 * ```
 */
export async function classifyPageTemplates(
	options: ClassifyPageTemplatesOptions,
): Promise<PageTemplateClassification> {
	const { archive, candidates, memoryBudget, onProgress } = options;

	onProgress?.({ phase: 'collecting-stylesheets' });
	const stylesheetsByUrl = await collectPageStylesheetUrls(archive);
	const { factory, urls } = createPageClusterFactory({
		archive,
		candidates,
		stylesheetsByUrl,
	});

	const { keys, reasons, sampledBlocks } = await resolvePageClusterKeys(factory, {
		...(memoryBudget === undefined ? {} : { memoryBudget }),
		...(onProgress ? { onProgress } : {}),
	});
	if (keys.length !== urls.length) {
		// Would silently mis-map template keys to the wrong URLs if allowed
		// through; the driver returns one key per page read, so this guards a
		// broken invariant loudly rather than assigning quietly.
		throw new Error(
			`classifyPageTemplates: resolvePageClusterKeys returned ${keys.length} keys for ${urls.length} pages.`,
		);
	}

	const templateKeysByUrl = new Map<string, string>();
	for (const [index, url] of urls.entries()) {
		templateKeysByUrl.set(url, keys[index]!);
	}
	const clusterReasonsByTemplateKey: ReadonlyMap<string, TemplateClusterReason> = reasons;

	return { templateKeysByUrl, clusterReasonsByTemplateKey, sampledBlocks };
}
