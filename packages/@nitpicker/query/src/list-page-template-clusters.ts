import type { TemplateClusterListResult, TemplateClusterSummary } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { computeDirectoryDistribution } from './compute-directory-distribution.js';
import { computeStylesheetFileNames } from './compute-stylesheet-file-names.js';
import { hasPageTemplatesTable } from './page-templates-join.js';
import { readClusterReasonsByTemplateKey } from './read-cluster-reasons-by-template-key.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Lists every `page_templates.template_key` cluster with a human-facing
 * summary — page count and top directories computed fresh from the
 * cluster's actual member pages, plus the `ClusterReason`
 * `@d-zero/page-cluster` reported when it classified the cluster (read back
 * from `page_template_cluster_reasons`, `null` when absent) — see
 * {@link TemplateClusterSummary} for why the raw key itself is not
 * human-readable on its own.
 *
 * **JOIN-order pitfall this function must avoid — verified against a real
 * 486,000-page archive:** resolving `page_templates.page_id` to a URL via a
 * direct `page_templates JOIN content_items JOIN url_refs` lets SQLite's
 * query planner pick a full scan of `url_refs` (1.57M rows on that archive)
 * as the outer loop instead of starting from `page_templates`'s much smaller
 * row set — 12s on that archive. Chunking `page_id` into `whereIn` value
 * lists (this function's approach, matching `eachSplitted`'s use elsewhere
 * in this package) keeps the planner on `content_items`'s `PRIMARY KEY`
 * search instead — 0.03s on the same archive. `ANALYZE` is forbidden
 * archive-wide (see ARCHITECTURE.md), so this is not something a statistics
 * hint can fix — the query shape itself has to avoid the pitfall.
 * **`hasClassification: true` does not guarantee the data is current.**
 * `@nitpicker/core`'s classify step (`nitpicker.ts`) only calls
 * `Archive.replacePageTemplates` when the freshly computed classification is
 * non-empty (`if (templateKeys.size > 0)`) — a re-run of `analyze --templates`
 * that legitimately classifies to zero pages (e.g. every previously-internal
 * HTML page was removed by a subsequent crawl) leaves the prior run's
 * `page_templates` rows in place untouched. This function has no way to
 * detect that staleness from `page_templates` alone; it reports whatever
 * rows currently exist as this archive's classification.
 * @param accessor - The archive accessor to query.
 * @returns `{ hasClassification: false, clusters: [] }` when the archive
 *   has never had `--templates` classification run — either because
 *   `page_templates` doesn't exist yet (pre-`--templates` archive) or
 *   because it exists but has zero rows (a fresh archive always provisions
 *   the table via `createAdjunctTables`, independent of whether
 *   `--templates` was ever passed to `analyze`) — see
 *   {@link TemplateClusterListResult} for why callers must not collapse this
 *   into an empty `clusters` array.
 * @example
 * ```ts
 * const { hasClassification, clusters } = await listPageTemplateClusters(accessor);
 * if (!hasClassification) {
 *   console.log('run `nitpicker analyze <archive> --templates` first');
 * }
 * ```
 */
export async function listPageTemplateClusters(
	accessor: ArchiveAccessor,
): Promise<TemplateClusterListResult> {
	const knex = accessor.getKnex();
	const hasTable = await hasPageTemplatesTable(knex);
	if (!hasTable) {
		return { hasClassification: false, clusters: [] };
	}

	const rows = (await knex('page_templates').select(
		'page_id as pageId',
		'template_key as templateKey',
	)) as { pageId: number; templateKey: string }[];

	// `page_templates` is provisioned by `createAdjunctTables` on every fresh
	// archive regardless of whether `--templates` was ever run — table
	// presence alone cannot distinguish "classification ran, zero pages
	// qualified" (impossible: `classifyPageTemplates` either yields a key for
	// every internal HTML page or is never called) from "classification
	// never ran". Zero rows means the latter in practice, so it gets the same
	// `hasClassification: false` treatment as a missing table.
	if (rows.length === 0) {
		return { hasClassification: false, clusters: [] };
	}

	const pageIdsByTemplateKey = new Map<string, number[]>();
	for (const row of rows) {
		const existing = pageIdsByTemplateKey.get(row.templateKey);
		if (existing) {
			existing.push(row.pageId);
		} else {
			pageIdsByTemplateKey.set(row.templateKey, [row.pageId]);
		}
	}

	const urlByPageId = new Map<number, string>();
	// The two operations below touch disjoint table sets (content_items/url_refs
	// vs page_template_cluster_reasons) and neither depends on the other's
	// result, so they run concurrently rather than back-to-back.
	const [, reasonsByTemplateKey] = await Promise.all([
		eachSplitted(
			rows.map((r) => r.pageId),
			SQLITE_IN_CHUNK,
			async (chunk) => {
				const urlRows = (await knex('content_items as ci')
					.join('url_refs as ur', 'ur.id', 'ci.url_id')
					.whereIn('ci.id', chunk)
					.select('ci.id as id', 'ur.url as url')) as { id: number; url: string }[];
				for (const urlRow of urlRows) {
					urlByPageId.set(urlRow.id, urlRow.url);
				}
			},
		),
		readClusterReasonsByTemplateKey(knex),
	]);

	const clusters: TemplateClusterSummary[] = [];
	for (const [templateKey, pageIds] of pageIdsByTemplateKey) {
		const urls = pageIds
			.map((id) => urlByPageId.get(id))
			.filter((url): url is string => url != null);
		const reason = reasonsByTemplateKey.get(templateKey) ?? null;
		const cssHrefs = (reason?.blocking ?? []).flatMap((entry) =>
			entry.reason.kind === 'css' ? entry.reason.distinctiveStylesheetHrefs : [],
		);
		clusters.push({
			templateKey,
			pageCount: pageIds.length,
			commonDirectories: computeDirectoryDistribution(urls),
			commonStylesheetFileNames: computeStylesheetFileNames(cssHrefs),
			reason,
		});
	}

	return { hasClassification: true, clusters };
}
