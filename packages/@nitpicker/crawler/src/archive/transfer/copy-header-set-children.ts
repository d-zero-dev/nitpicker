import type { Knex } from 'knex';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/**
 * Copies `header_set_entries` and `header_flags` — the two children of
 * `header_sets` that have no id of their own to map (`header_set_entries`
 * is `WITHOUT ROWID` with a composite PK; `header_flags`' PK IS
 * `header_set_id`), so both are remapped and copied directly rather than
 * going through the generic `temp.xfer_map_<table>` machinery
 * {@link import('./copy-dictionaries-for-concat.js').copyDictionariesForConcat} /
 * {@link import('./copy-dictionaries-for-split.js').copyDictionariesForSplit}
 * use for id-keyed dictionaries.
 *
 * Both are filtered implicitly: only `header_sets` rows that were
 * actually copied have an entry in `temp.xfer_map_header_sets`, so a
 * source header set that split's need-computation skipped (belongs only
 * to a dropped page) naturally contributes no entries/flags row either —
 * no separate need-set for these two tables is required.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after `temp.xfer_map_header_sets`,
 *   `temp.xfer_map_header_name_refs`, and `temp.xfer_map_header_value_refs`
 *   are populated — i.e. after `copyDictionariesForConcat`/`copyDictionariesForSplit`.
 * @example
 * ```ts
 * await copyDictionariesForConcat(trx); // or copyDictionariesForSplit
 * await copyHeaderSetChildren(trx);
 * ```
 */
export async function copyHeaderSetChildren(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO main.header_set_entries (header_set_id, name_id, occurrence, value_id, is_volatile)
		SELECT mhs.dest_id, mhn.dest_id, s.occurrence, mhv.dest_id, s.is_volatile
		FROM ${TRANSFER_SOURCE_ALIAS}.header_set_entries s
		JOIN xfer_map_header_sets mhs ON mhs.src_id = s.header_set_id
		JOIN xfer_map_header_name_refs mhn ON mhn.src_id = s.name_id
		JOIN xfer_map_header_value_refs mhv ON mhv.src_id = s.value_id
		WHERE true
		ON CONFLICT(header_set_id, name_id, occurrence) DO NOTHING
	`);

	const flagColumns = await listTransferColumns(
		trx,
		TRANSFER_SOURCE_ALIAS,
		'header_flags',
		['header_set_id'],
	);
	const quotedFlagColumns = flagColumns.map(quoteTransferIdentifier);
	const selectList = quotedFlagColumns.map((col) => `s.${col}`).join(', ');
	await trx.raw(`
		INSERT INTO main.header_flags (header_set_id, ${quotedFlagColumns.join(', ')})
		SELECT mhs.dest_id, ${selectList}
		FROM ${TRANSFER_SOURCE_ALIAS}.header_flags s
		JOIN xfer_map_header_sets mhs ON mhs.src_id = s.header_set_id
		WHERE true
		ON CONFLICT(header_set_id) DO NOTHING
	`);
}
