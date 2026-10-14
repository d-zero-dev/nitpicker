import type {
	ClassifyArchivePageTemplatesOptions,
	ClassifyArchivePageTemplatesResult,
} from './types.js';
import type Archive from '../archive.js';

import { classifyPageTemplates } from './classify-page-templates.js';
import { collectPageIdsWithHtml } from './collect-page-ids-with-html.js';
import { loadPageClusterCandidates } from './load-page-cluster-candidates.js';

/**
 * Classifies every internal HTML page of the archive into a template group
 * by DOM-structure similarity and persists the result to `page_templates`,
 * `page_template_clusters` and `page_template_labels`.
 *
 * This is the crawl-end derived-data step (alongside the JS-resource scan
 * and the viewer read-model build): the crawl command runs it before the
 * archive is written, and `viewer-build` / `concat` / `split` re-run it on
 * their archive. It is a corpus-wide batch computation (template keys are
 * only comparable within one run), not a per-page one.
 *
 * The signals of every internal HTML page with a stored snapshot are loaded
 * before clustering starts (`loadPageClusterCandidates`: ids and the few
 * columns the classifier reads, no `Page` objects) and clustered **once**,
 * never per loading batch: per-batch keys would only be comparable within
 * their own batch.
 *
 * A run that classifies no page at all (no internal page has a stored HTML
 * snapshot to cluster) leaves the stored classification untouched instead of
 * replacing it with an empty one: nothing could be re-derived, and erasing a
 * previous classification (e.g. rows `concat` copied from its sources) would
 * lose data for no gain. Whenever at least one page is classified the stored
 * classification is replaced wholesale; labels survive either way —
 * `replacePageTemplates` carries them forward across runs and keeps retired
 * ones.
 * @param archive - A writable archive (crawl-end orchestrator archive, or one
 *   opened for `viewer-build` / created by `concat` / `split`).
 * @param options - See {@link ClassifyArchivePageTemplatesOptions}.
 * @returns See {@link ClassifyArchivePageTemplatesResult}.
 * @throws {Error} Whatever page loading, clustering or the write throws — callers
 *   that treat classification as best-effort (all CLI paths) catch it.
 * @example
 * ```ts
 * const { classifiedPageCount, templateCount } = await classifyArchivePageTemplates(
 *   archive,
 *   { onProgress: (event) => console.error(event.phase) },
 * );
 * ```
 */
export async function classifyArchivePageTemplates(
	archive: Archive,
	options: ClassifyArchivePageTemplatesOptions = {},
): Promise<ClassifyArchivePageTemplatesResult> {
	const { memoryBudget, onProgress } = options;

	onProgress?.({ phase: 'listing-html-snapshots' });
	const pageIdsWithHtml = await collectPageIdsWithHtml(archive);

	onProgress?.({ phase: 'loading-pages-start' });
	const candidates = await loadPageClusterCandidates(archive, {
		pageIdsWithHtml,
		...(onProgress ? { onProgress } : {}),
	});

	const classification = await classifyPageTemplates({
		archive,
		candidates,
		...(memoryBudget === undefined ? {} : { memoryBudget }),
		onProgress,
	});

	if (classification.templateKeysByUrl.size > 0) {
		onProgress?.({
			phase: 'writing-results',
			templateCount: new Set(classification.templateKeysByUrl.values()).size,
		});
		await archive.replacePageTemplates(
			classification.templateKeysByUrl,
			classification.clusterReasonsByTemplateKey,
		);
	}

	return {
		classifiedPageCount: classification.templateKeysByUrl.size,
		templateCount: new Set(classification.templateKeysByUrl.values()).size,
		sampledBlocks: classification.sampledBlocks,
	};
}
