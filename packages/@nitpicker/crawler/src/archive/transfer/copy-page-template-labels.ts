import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies `page_template_labels` rows referenced by at least one kept
 * (`full`/`replace`) page's `page_templates.template_key`, prunes any label
 * whose key no longer has a member in the destination's OWN
 * `page_templates`, and then **renumbers label collisions**: two sources
 * (concat) number their labels independently, so both can carry an
 * "events template A" under different keys. Leaving both would give the
 * merged archive two templates with one name — and a later
 * `analyze --templates` would *keep* both, since `replacePageTemplates`
 * carries labels forward by member overlap rather than renaming. The later
 * key (by `template_key` order, for determinism) is therefore moved to the
 * next free ordinal in its section here, at copy time.
 *
 * A `template_key` collision (the same key string in both sources) is the
 * same accepted simplification as in
 * {@link import('./copy-page-template-clusters.js').copyPageTemplateClusters}:
 * `ON CONFLICT(template_key) DO NOTHING` keeps the FIRST source's label.
 *
 * A source extracted by an older nitpicker — the tar cache is keyed without
 * a schema version, so an archive first opened before this table existed
 * stays without it until re-extracted — has no `page_template_labels` at
 * all; that source simply contributes no labels rather than failing the
 * whole transfer.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   `copySimplePageScopedTables` (which copies `page_templates` itself).
 * @example
 * ```ts
 * await copySimplePageScopedTables(trx); // copies page_templates
 * await copyPageTemplateLabels(trx);
 * ```
 */
export async function copyPageTemplateLabels(trx: Knex): Promise<void> {
	const [sourceTable] = (await trx.raw(
		`SELECT name FROM ${SRC}.sqlite_master WHERE type = 'table' AND name = 'page_template_labels'`,
	)) as { name: string }[];
	if (sourceTable) {
		await trx.raw(`
			INSERT INTO main.page_template_labels (template_key, section, ordinal)
			SELECT s.template_key, s.section, s.ordinal
			FROM ${SRC}.page_template_labels s
			WHERE EXISTS (
				SELECT 1
				FROM ${SRC}.page_templates pt
				JOIN xfer_ci_plan p ON p.src_id = pt.page_id
					AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
				WHERE pt.template_key = s.template_key
			)
			ON CONFLICT(template_key) DO NOTHING
		`);
	}

	await trx.raw(`
		DELETE FROM main.page_template_labels
		WHERE NOT EXISTS (
			SELECT 1 FROM main.page_templates
			WHERE main.page_templates.template_key = main.page_template_labels.template_key
		)
	`);

	await renumberLabelCollisions(trx);
}

/**
 * Gives every `(section, ordinal)` pair held by more than one key a fresh,
 * unused ordinal for all but the first key (by `template_key` order).
 * @param trx - The transfer transaction.
 */
async function renumberLabelCollisions(trx: Knex): Promise<void> {
	const rows = (await trx('main.page_template_labels')
		.select('template_key as templateKey', 'section', 'ordinal')
		.orderBy('template_key')) as {
		templateKey: string;
		section: string | null;
		ordinal: number;
	}[];

	const maxOrdinalBySection = new Map<string | null, number>();
	for (const row of rows) {
		maxOrdinalBySection.set(
			row.section,
			Math.max(maxOrdinalBySection.get(row.section) ?? 0, row.ordinal),
		);
	}
	const seen = new Set<string>();
	for (const row of rows) {
		const pair = `${row.section ?? '\0'}:${row.ordinal}`;
		if (!seen.has(pair)) {
			seen.add(pair);
			continue;
		}
		const next = (maxOrdinalBySection.get(row.section) ?? 0) + 1;
		maxOrdinalBySection.set(row.section, next);
		await trx('main.page_template_labels')
			.where('template_key', row.templateKey)
			.update({ ordinal: next });
	}
}
