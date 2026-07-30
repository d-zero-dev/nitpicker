import type { TemplateClusterReason } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { decodeJsonRef, eachSplitted } from '@nitpicker/crawler';

import { hasPageTemplateClustersTable } from './has-page-template-clusters-table.js';
import { isTemplateClusterReason } from './is-template-cluster-reason.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Reads the stored `@d-zero/page-cluster` cluster-selection reason for each
 * of `templateKeys`, keyed by `template_key`.
 *
 * Filtered to `templateKeys` (the keys `listPageTemplateClusters` actually
 * has member pages for) rather than reading every `page_template_clusters`
 * row — the table can carry orphaned reason rows for keys no page currently
 * maps to (see `replacePageTemplates`'s own JSDoc on why those aren't
 * cleaned up), and decompressing/parsing/validating those on every read
 * would be wasted work no caller uses.
 *
 * Absent, corrupt, or shape-mismatched rows are skipped rather than
 * failing the whole read — one bad reason should not hide every other
 * cluster's evidence from the viewer. Skipped keys are simply missing
 * from the returned map; callers treat that the same as "no reason
 * captured for this cluster" (see
 * {@link import('./types.js').TemplateClusterSummary.reason}).
 * @param knex - Knex query builder connected to the archive DB.
 * @param templateKeys - The template keys to load reasons for.
 * @returns Template key → decoded reason. Empty when the table is absent,
 *   `templateKeys` is empty, or no row matched.
 * @example
 * const reasons = await loadTemplateClusterReasons(knex, [...pageIdsByTemplateKey.keys()]);
 * const reason = reasons.get(templateKey);
 */
export async function loadTemplateClusterReasons(
	knex: Knex,
	templateKeys: readonly string[],
): Promise<Map<string, TemplateClusterReason>> {
	const hasTable = await hasPageTemplateClustersTable(knex);
	const reasons = new Map<string, TemplateClusterReason>();
	if (!hasTable || templateKeys.length === 0) {
		return reasons;
	}

	await eachSplitted(templateKeys, SQLITE_IN_CHUNK, async (chunk) => {
		const rows = (await knex('page_template_clusters')
			.whereIn('template_key', chunk)
			.select('template_key as templateKey', 'reason_json as reasonJson', 'codec')) as {
			templateKey: string;
			reasonJson: Buffer | null;
			codec: 'zstd' | 'none' | null;
		}[];

		for (const row of rows) {
			const decoded = decodeJsonRef(row.reasonJson, row.codec);
			if (decoded == null) {
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(decoded);
			} catch {
				continue;
			}
			if (isTemplateClusterReason(parsed)) {
				reasons.set(row.templateKey, parsed);
			}
		}
	});

	return reasons;
}
