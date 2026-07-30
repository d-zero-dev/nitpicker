import type { ReplacePageTemplatesParams } from './types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../utils/array/each-splitted.js';
import { compressPayload } from '../_shared/compress-payload.js';

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
 * `page_template_clusters` is always cleared alongside `page_templates`
 * regardless of whether `clusterReasonsByTemplateKey` is passed — "no
 * reason" must mean "not captured for this run", never "carry over the
 * previous run's reason". Reason rows are inserted for every key in
 * `clusterReasonsByTemplateKey` even if some have no surviving member page
 * in `templateKeysByUrl` after URL-resolution skips above — harmless
 * (nothing joins `page_template_clusters` back to `page_templates` by FK;
 * see the table's own JSDoc), and simpler than cross-filtering the two maps.
 * @param knex - Knex query builder connected to the archive DB.
 * @param params - See {@link ReplacePageTemplatesParams}.
 */
export async function replacePageTemplates(
	knex: Knex,
	params: ReplacePageTemplatesParams,
): Promise<void> {
	const { templateKeysByUrl, clusterReasonsByTemplateKey } = params;

	// Compressing every reason is pure CPU work independent of the DB — done
	// before opening the transaction below so it doesn't extend how long the
	// SQLite write-lock is held for.
	const reasonRows =
		clusterReasonsByTemplateKey && clusterReasonsByTemplateKey.size > 0
			? [...clusterReasonsByTemplateKey].map(([templateKey, reason]) => {
					const { body, codec, sizeRaw, sizeStored } = compressPayload(
						Buffer.from(JSON.stringify(reason), 'utf8'),
					);
					return {
						template_key: templateKey,
						member_count: reason.memberCount,
						reason_json: body,
						codec,
						size_raw: sizeRaw,
						size_stored: sizeStored,
					};
				})
			: [];

	await knex.transaction(async (trx) => {
		await trx('page_templates').delete();
		await trx('page_template_clusters').delete();

		if (reasonRows.length > 0) {
			await eachSplitted(reasonRows, 100, async (chunk) => {
				await trx('page_template_clusters').insert(chunk);
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
