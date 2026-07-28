import type { TemplateClusterReasonSummary } from './types.js';
import type { Knex } from 'knex';

/**
 * Reads every stored `ClusterReason` from `page_template_cluster_reasons`,
 * keyed by `template_key`.
 *
 * Guards on table presence rather than assuming it exists: a viewer's
 * read-only connection to a live/interrupted crawl skips schema self-heal
 * entirely (see `@nitpicker/crawler`'s `db-ops/lifecycle/init.ts`), and an
 * archive classified before `@d-zero/page-cluster@0.5.0` shipped
 * `onClusterReason` never had this table provisioned either — both cases
 * degrade to an empty map (every `templateKey` then resolves to `reason:
 * null` in {@link listPageTemplateClusters}) rather than a thrown
 * `no such table` error, matching `hasPageTemplatesTable`'s existing
 * degrade-to-null pattern for `page_templates` itself.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Map from `template_key` to its parsed `ClusterReason`. Empty when
 *   the table doesn't exist (see above) or has zero rows.
 * @example
 * ```ts
 * const reasons = await readClusterReasonsByTemplateKey(knex);
 * const reason = reasons.get(templateKey) ?? null;
 * ```
 */
export async function readClusterReasonsByTemplateKey(
	knex: Knex,
): Promise<Map<string, TemplateClusterReasonSummary>> {
	const hasTable = await knex.schema.hasTable('page_template_cluster_reasons');
	if (!hasTable) {
		return new Map();
	}

	const rows = (await knex('page_template_cluster_reasons').select(
		'template_key as templateKey',
		'member_count as memberCount',
		'blocking',
		'structural_core_tokens as structuralCoreTokens',
		'landmarks',
		'sibling_cluster_keys as siblingClusterKeys',
	)) as {
		templateKey: string;
		memberCount: number;
		blocking: string;
		structuralCoreTokens: string;
		landmarks: string;
		siblingClusterKeys: string;
	}[];

	const reasonsByTemplateKey = new Map<string, TemplateClusterReasonSummary>();
	for (const row of rows) {
		reasonsByTemplateKey.set(row.templateKey, {
			memberCount: row.memberCount,
			blocking: JSON.parse(row.blocking) as TemplateClusterReasonSummary['blocking'],
			structuralCoreTokens: JSON.parse(row.structuralCoreTokens) as string[],
			landmarks: JSON.parse(row.landmarks) as TemplateClusterReasonSummary['landmarks'],
			siblingClusterKeys: JSON.parse(row.siblingClusterKeys) as string[],
		});
	}
	return reasonsByTemplateKey;
}
