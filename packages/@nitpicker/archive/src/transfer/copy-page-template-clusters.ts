import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies `page_template_clusters` rows referenced by at least one kept
 * (`full`/`replace`) page's `page_templates.template_key`, then
 * recomputes `member_count` (and prunes any cluster left with zero
 * members) against the destination's OWN `page_templates` table — which
 * must already reflect this source's copy
 * ({@link import('./copy-simple-page-scoped-tables.js').copySimplePageScopedTables},
 * which carries `page_templates` — see that file's table list).
 *
 * A `template_key` collision between two DIFFERENT sources' clustering
 * runs (concat) is a known, accepted simplification: `template_key` is a
 * blocking-key string from page-cluster's own corpus
 * classification, computed independently per archive, so the same string
 * appearing in two sources does not necessarily mean the same semantic
 * template — `ON CONFLICT(template_key) DO NOTHING` below means the
 * FIRST source's `reason_json` (cluster-selection evidence) wins and the
 * merged `member_count` recompute mixes both sources' pages under it.
 * `concat` therefore re-classifies its output right after this copy,
 * recomputing clean, merged-corpus clusters (see `docs/concat.md`); the
 * copied rows only seed label inheritance for that run.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   `copySimplePageScopedTables` (which copies `page_templates` itself).
 * @example
 * ```ts
 * await copySimplePageScopedTables(trx); // copies page_templates
 * await copyPageTemplateClusters(trx);
 * ```
 */
export async function copyPageTemplateClusters(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO main.page_template_clusters
			(template_key, member_count, reason_json, codec, size_raw, size_stored)
		SELECT s.template_key, s.member_count, s.reason_json, s.codec, s.size_raw, s.size_stored
		FROM ${SRC}.page_template_clusters s
		WHERE EXISTS (
			SELECT 1
			FROM ${SRC}.page_templates pt
			JOIN xfer_ci_plan p ON p.src_id = pt.page_id
				AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
			WHERE pt.template_key = s.template_key
		)
		ON CONFLICT(template_key) DO NOTHING
	`);

	await trx.raw(`
		UPDATE main.page_template_clusters
		SET member_count = (
			SELECT COUNT(*) FROM main.page_templates
			WHERE main.page_templates.template_key = main.page_template_clusters.template_key
		)
	`);
	await trx.raw('DELETE FROM main.page_template_clusters WHERE member_count = 0');
}
