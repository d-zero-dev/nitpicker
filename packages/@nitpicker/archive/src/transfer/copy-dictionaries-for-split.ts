import type { Knex } from 'knex';

import { PAGE_META_COLUMN_MAPS } from '../page-meta-column-maps.js';

import { DICTIONARY_COPY_SPECS } from './dictionary-copy-specs.js';
import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';
import { TransferIntegrityError } from './types.js';

const SRC = TRANSFER_SOURCE_ALIAS;
const FULL = TRANSFER_ACTION.full;

/**
 * Collects dictionary ids referenced directly by `content_items` /
 * `resource_items` rows the plan keeps — every plan action for
 * `content_items` (both `full` and `stub`; a stub still carries its own
 * `url_id`/`content_type_id`/`header_set_id`, the same fields a genuine
 * external HEAD-only observation would record) and every kept
 * (`full`-only, per `plan-resource-items.ts`'s split branch) resource.
 * @param trx - Transaction with the source ATTACHed.
 */
async function collectContentItemLevelNeeds(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_url_refs (src_id)
		SELECT s.url_id FROM ${SRC}.content_items s JOIN xfer_ci_plan p ON p.src_id = s.id
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_content_type_refs (src_id)
		SELECT s.content_type_id FROM ${SRC}.content_items s JOIN xfer_ci_plan p ON p.src_id = s.id
		WHERE s.content_type_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_header_sets (src_id)
		SELECT s.header_set_id FROM ${SRC}.content_items s JOIN xfer_ci_plan p ON p.src_id = s.id
		WHERE s.header_set_id IS NOT NULL
	`);

	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_url_refs (src_id)
		SELECT r.url_id FROM ${SRC}.resource_items r JOIN xfer_ri_plan rp ON rp.src_id = r.id
		WHERE r.url_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_blob_refs (src_id)
		SELECT r.url_blob_id FROM ${SRC}.resource_items r JOIN xfer_ri_plan rp ON rp.src_id = r.id
		WHERE r.url_blob_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_content_type_refs (src_id)
		SELECT r.content_type_id FROM ${SRC}.resource_items r JOIN xfer_ri_plan rp ON rp.src_id = r.id
		WHERE r.content_type_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_header_sets (src_id)
		SELECT r.header_set_id FROM ${SRC}.resource_items r JOIN xfer_ri_plan rp ON rp.src_id = r.id
		WHERE r.header_set_id IS NOT NULL
	`);
}

/**
 * Collects dictionary ids referenced by page-scoped data (`page_meta`,
 * `anchor_edges`, `image_items`) — only from `full`
 * pages, since `stub` rows never get any of these copied
 * (`copy-page-meta.ts` et al. only ever read `full`-action rows).
 * @param trx - Transaction with the source ATTACHed.
 */
async function collectPageScopedNeeds(trx: Knex): Promise<void> {
	for (const { target } of PAGE_META_COLUMN_MAPS.url) {
		await trx.raw(`
			INSERT OR IGNORE INTO xfer_need_url_refs (src_id)
			SELECT pm.${target} FROM ${SRC}.page_meta pm
			JOIN xfer_ci_plan p ON p.src_id = pm.page_id AND p.action = ${FULL}
			WHERE pm.${target} IS NOT NULL
		`);
	}
	for (const { target } of PAGE_META_COLUMN_MAPS.text) {
		await trx.raw(`
			INSERT OR IGNORE INTO xfer_need_text_refs (src_id)
			SELECT pm.${target} FROM ${SRC}.page_meta pm
			JOIN xfer_ci_plan p ON p.src_id = pm.page_id AND p.action = ${FULL}
			WHERE pm.${target} IS NOT NULL
		`);
	}
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_json_refs (src_id)
		SELECT pm.meta_extras_json_id FROM ${SRC}.page_meta pm
		JOIN xfer_ci_plan p ON p.src_id = pm.page_id AND p.action = ${FULL}
		WHERE pm.meta_extras_json_id IS NOT NULL
	`);

	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_text_refs (src_id)
		SELECT ae.first_text_id FROM ${SRC}.anchor_edges ae
		JOIN xfer_ci_plan p ON p.src_id = ae.page_id AND p.action = ${FULL}
		WHERE ae.first_text_id IS NOT NULL
	`);

	for (const column of ['src_url_id', 'current_src_url_id']) {
		await trx.raw(`
			INSERT OR IGNORE INTO xfer_need_url_refs (src_id)
			SELECT ii.${column} FROM ${SRC}.image_items ii
			JOIN xfer_ci_plan p ON p.src_id = ii.page_id AND p.action = ${FULL}
			WHERE ii.${column} IS NOT NULL
		`);
	}
	for (const column of ['src_blob_id', 'current_src_blob_id']) {
		await trx.raw(`
			INSERT OR IGNORE INTO xfer_need_blob_refs (src_id)
			SELECT ii.${column} FROM ${SRC}.image_items ii
			JOIN xfer_ci_plan p ON p.src_id = ii.page_id AND p.action = ${FULL}
			WHERE ii.${column} IS NOT NULL
		`);
	}
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_text_refs (src_id)
		SELECT ii.alt_text_id FROM ${SRC}.image_items ii
		JOIN xfer_ci_plan p ON p.src_id = ii.page_id AND p.action = ${FULL}
		WHERE ii.alt_text_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_text_refs (src_id)
		SELECT ii.dom_path_text_id FROM ${SRC}.image_items ii
		JOIN xfer_ci_plan p ON p.src_id = ii.page_id AND p.action = ${FULL}
	`);
}

/**
 * Collects `console_log_items` referenced by kept pages' `page_console_logs`,
 * then that dictionary's OWN url/text/json needs — a second-order need
 * only `console_log_items` has, since it is itself a dictionary that
 * points into three other dictionaries.
 * @param trx - Transaction with the source ATTACHed.
 */
async function collectConsoleLogNeeds(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_console_log_items (src_id)
		SELECT pcl.consoleLogId FROM ${SRC}.page_console_logs pcl
		JOIN xfer_ci_plan p ON p.src_id = pcl.pageId AND p.action = ${FULL}
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_url_refs (src_id)
		SELECT cli.loc_url_id FROM ${SRC}.console_log_items cli
		JOIN xfer_need_console_log_items n ON n.src_id = cli.id
		WHERE cli.loc_url_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_text_refs (src_id)
		SELECT cli.text_id FROM ${SRC}.console_log_items cli
		JOIN xfer_need_console_log_items n ON n.src_id = cli.id
		WHERE cli.text_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_text_refs (src_id)
		SELECT cli.stack_text_id FROM ${SRC}.console_log_items cli
		JOIN xfer_need_console_log_items n ON n.src_id = cli.id
		WHERE cli.stack_text_id IS NOT NULL
	`);
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_need_json_refs (src_id)
		SELECT cli.args_json_id FROM ${SRC}.console_log_items cli
		JOIN xfer_need_console_log_items n ON n.src_id = cli.id
		WHERE cli.args_json_id IS NOT NULL
	`);
}

/**
 * Copies only the dictionary rows referenced by kept content — the split
 * counterpart of `copy-dictionaries-for-concat.ts`'s unconditional
 * copy-everything. Split's entire purpose is size reduction, so (unlike
 * concat, where computing a precise needed-set is not worth the
 * complexity) a dropped page's dictionary rows must not survive into the
 * output archive.
 *
 * Runs in two phases: collect every needed dictionary id into
 * `temp.xfer_need_<table>` (this function's own private helpers, in
 * dependency order — `console_log_items`' own needs must be collected
 * AFTER `console_log_items` itself, since they derive from it), then copy
 * + map each dictionary table exactly like concat but filtered to the
 * needed set.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   `temp.xfer_ci_plan` AND `temp.xfer_ri_plan` are fully populated.
 * @throws {import('./types.js').TransferIntegrityError} If any table's
 *   mapped row count does not equal its needed-row count after the
 *   natural-key JOIN.
 * @example
 * ```ts
 * await planContentItemsForSplit(trx);
 * await planResourceItems(trx, 'split');
 * await copyDictionariesForSplit(trx);
 * ```
 */
export async function copyDictionariesForSplit(trx: Knex): Promise<void> {
	await collectContentItemLevelNeeds(trx);
	await collectPageScopedNeeds(trx);
	await collectConsoleLogNeeds(trx);

	for (const spec of DICTIONARY_COPY_SPECS) {
		const columns = await listTransferColumns(trx, SRC, spec.table, ['id']);
		const quotedColumns = columns.map(quoteTransferIdentifier);
		const columnList = quotedColumns.join(', ');
		const conflictTarget = spec.naturalKey.map(quoteTransferIdentifier).join(', ');
		await trx.raw(`
			INSERT INTO main.${spec.table} (${columnList})
			SELECT ${columnList} FROM ${SRC}.${spec.table} s
			JOIN xfer_need_${spec.table} n ON n.src_id = s.id
			WHERE true
			ON CONFLICT(${conflictTarget}) DO NOTHING
		`);

		const joinCondition = spec.naturalKey
			.map(
				(col) => `d.${quoteTransferIdentifier(col)} IS s.${quoteTransferIdentifier(col)}`,
			)
			.join(' AND ');
		await trx.raw(`
			INSERT INTO xfer_map_${spec.table} (src_id, dest_id)
			SELECT s.id, d.id
			FROM ${SRC}.${spec.table} s
			JOIN xfer_need_${spec.table} n ON n.src_id = s.id
			JOIN main.${spec.table} d ON ${joinCondition}
		`);

		// Every NEEDED source row must resolve to a destination id (unlike
		// concat, split's needed-set can legitimately be a strict subset of
		// the source table — that is the whole point). A gap between
		// `xfer_need_<table>` and `xfer_map_<table>` means the natural-key
		// JOIN failed to match a row this same function just inserted,
		// which should be impossible; treat it as a hard integrity failure.
		const neededCountRows = await trx(`xfer_need_${spec.table}`).count<
			{ neededCount: number }[]
		>({ neededCount: '*' });
		const mappedCountRows = await trx(`xfer_map_${spec.table}`).count<
			{ mappedCount: number }[]
		>({ mappedCount: '*' });
		const neededCount = neededCountRows[0]?.neededCount ?? 0;
		const mappedCount = mappedCountRows[0]?.mappedCount ?? 0;
		if (Number(mappedCount) !== Number(neededCount)) {
			throw new TransferIntegrityError(
				`copyDictionariesForSplit: ${spec.table} needs ${neededCount} row(s) but only ${mappedCount} mapped to a destination id`,
			);
		}
	}
}
