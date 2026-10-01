import type { TemplateLabel } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { eachSplitted } from '@nitpicker/crawler';

import { hasPageTemplateLabelsTable } from './has-page-template-labels-table.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Reads the stored human-facing label of each of `templateKeys` from
 * `page_template_labels`, keyed by `template_key`.
 *
 * Filtered to `templateKeys` for the same reason as
 * {@link import('./load-template-cluster-reasons.js').loadTemplateClusterReasons}:
 * only the keys that currently have member pages matter to a caller.
 * @param knex - Knex query builder connected to the archive DB.
 * @param templateKeys - The template keys to load labels for.
 * @returns Template key → label. Empty when the table is absent,
 *   `templateKeys` is empty, or no row matched — a caller that gets an
 *   empty map back for a classified archive knows the classification
 *   predates stored labels.
 * @example
 * const labels = await loadTemplateClusterLabels(knex, [...pageIdsByTemplateKey.keys()]);
 */
export async function loadTemplateClusterLabels(
	knex: Knex,
	templateKeys: readonly string[],
): Promise<Map<string, TemplateLabel>> {
	const labels = new Map<string, TemplateLabel>();
	if (templateKeys.length === 0 || !(await hasPageTemplateLabelsTable(knex))) {
		return labels;
	}
	await eachSplitted(templateKeys, SQLITE_IN_CHUNK, async (chunk) => {
		const rows = (await knex('page_template_labels')
			.whereIn('template_key', chunk)
			.select('template_key as templateKey', 'section', 'ordinal')) as {
			templateKey: string;
			section: string | null;
			ordinal: number;
		}[];
		for (const row of rows) {
			labels.set(row.templateKey, { section: row.section, ordinal: row.ordinal });
		}
	});
	return labels;
}
