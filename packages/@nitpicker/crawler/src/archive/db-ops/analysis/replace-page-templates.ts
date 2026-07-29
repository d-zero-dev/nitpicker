import type { ClusterReasonData } from '../../types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../utils/array/each-splitted.js';

/**
 * Replaces the stored DOM-structure template classification (`--templates`)
 * with a freshly generated set.
 *
 * Every classified page is a full-archive, all-or-nothing recomputation
 * (see `@nitpicker/core`'s `classifyPageTemplates`), so this always deletes
 * every existing row before inserting the new set — there is no per-page
 * incremental update path, matching `replaceAnalysisViolations`'s
 * whole-table replace shape. Unlike violations, a page whose URL can't be
 * resolved back to a `content_items` row is silently skipped rather than
 * treated as a hard failure: losing one page's template classification
 * (e.g. a URL-normalization mismatch between the in-memory `Page.url.href`
 * and the stored `url_refs.url`) should not discard the rest of a
 * potentially multi-thousand-page classification run.
 *
 * `page_templates` and `page_template_cluster_reasons` are replaced in the
 * same transaction as each other so the two tables never observe a torn
 * write (one updated, the other still holding the previous run's data).
 * Cluster reasons are looked up by `templateKey` directly — unlike
 * page rows, no URL → `content_items` resolution is needed since
 * `page_template_cluster_reasons` has no page-level FK.
 * @param knex - Knex query builder connected to the archive DB.
 * @param templateKeysByUrl - Page URL → template key, as produced by
 *   `classifyPageTemplates`.
 * @param clusterReasonsByTemplateKey - Template key → the `ClusterReason`
 *   `@d-zero/page-cluster` reported for it, as produced by
 *   `classifyPageTemplates`.
 */
export async function replacePageTemplates(
	knex: Knex,
	templateKeysByUrl: ReadonlyMap<string, string>,
	clusterReasonsByTemplateKey: ReadonlyMap<string, ClusterReasonData>,
): Promise<void> {
	await knex.transaction(async (trx) => {
		await trx('page_templates').delete();
		await trx('page_template_cluster_reasons').delete();

		if (clusterReasonsByTemplateKey.size > 0) {
			const reasonRows = [...clusterReasonsByTemplateKey].map(
				([templateKey, reason]) => ({
					template_key: templateKey,
					member_count: reason.memberCount,
					blocking: JSON.stringify(reason.blocking),
					structural_core_tokens: JSON.stringify(reason.structuralCoreTokens),
					landmarks: JSON.stringify(reason.landmarks),
					sibling_cluster_keys: JSON.stringify(reason.siblingClusterKeys),
				}),
			);
			await eachSplitted(reasonRows, 500, async (chunk) => {
				await trx('page_template_cluster_reasons').insert(chunk);
			});
		}

		if (templateKeysByUrl.size === 0) {
			return;
		}

		const urls = [...templateKeysByUrl.keys()];
		const pageIdByUrl = new Map<string, number>();
		await eachSplitted(urls, 500, async (chunk) => {
			const pageRows = await trx('content_items')
				.join('url_refs', 'url_refs.id', 'content_items.url_id')
				.select('content_items.id as id', 'url_refs.url as url')
				.whereIn('url_refs.url', chunk);
			for (const row of pageRows) {
				pageIdByUrl.set(row.url, row.id);
			}
		});

		const rows: Array<{ page_id: number; template_key: string }> = [];
		for (const [url, templateKey] of templateKeysByUrl) {
			const pageId = pageIdByUrl.get(url);
			if (pageId == null) {
				continue;
			}
			rows.push({ page_id: pageId, template_key: templateKey });
		}
		if (rows.length === 0) {
			return;
		}

		await eachSplitted(rows, 500, async (chunk) => {
			await trx('page_templates').insert(chunk);
		});
	});
}
