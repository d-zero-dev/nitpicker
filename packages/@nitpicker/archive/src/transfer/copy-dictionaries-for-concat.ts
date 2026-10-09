import type { Knex } from 'knex';

import { DICTIONARY_COPY_SPECS } from './dictionary-copy-specs.js';
import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';
import { TransferIntegrityError } from './types.js';

/**
 * Copies every dictionary table's rows from the attached source into the
 * destination unconditionally (`ON CONFLICT DO NOTHING` on the natural
 * key), then builds a `temp.xfer_map_<table>` mapping every source row's id
 * to its (possibly pre-existing, possibly freshly-inserted) destination
 * id.
 *
 * Concat does not compute a "needed by kept content" filter first, unlike
 * split (`copy-dictionaries-for-split.ts`) — every dictionary row is
 * copied whether or not the content_items row(s) that referenced it ended
 * up `full`/`replace` or `skip`. This can leave a handful of dictionary
 * rows in the destination with no live referrer (a source's `skip`ped
 * row's own `text_refs`/`url_refs`, say), the same accepted trade-off this
 * archive already makes for `page_html_blobs` orphans (pending #23's GC) —
 * computing a precise per-source needed-set here would roughly double the
 * SQL in this file for a storage saving that matters far less than
 * concat's own priority order (viewer compat > read perf > storage, see
 * `viewer-priority-order.md`).
 *
 * `console_log_items` and `page_html_blobs` are copied by
 * `copy-page-console-logs.ts` / `copy-page-html-blobs.ts` respectively —
 * both need a source-row need-set derived from `page_console_logs`/
 * `page_html_ref` regardless of concat/split, so they are not duplicated
 * here.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   {@link import('./create-transfer-temp-tables.js').createTransferTempTables}.
 * @throws {import('./types.js').TransferIntegrityError} If any table's
 *   mapped row count does not equal its source row count after the
 *   natural-key JOIN — see this function's body for why that should be
 *   structurally impossible in normal operation.
 * @example
 * ```ts
 * await copyDictionariesForConcat(trx);
 * // temp.xfer_map_url_refs, temp.xfer_map_text_refs, ... are now populated
 * ```
 */
export async function copyDictionariesForConcat(trx: Knex): Promise<void> {
	for (const spec of DICTIONARY_COPY_SPECS) {
		const columns = await listTransferColumns(trx, TRANSFER_SOURCE_ALIAS, spec.table, [
			'id',
		]);
		const quotedColumns = columns.map(quoteTransferIdentifier);
		const columnList = quotedColumns.join(', ');
		const conflictTarget = spec.naturalKey.map(quoteTransferIdentifier).join(', ');
		await trx.raw(`
			INSERT INTO main.${spec.table} (${columnList})
			SELECT ${columnList} FROM ${TRANSFER_SOURCE_ALIAS}.${spec.table}
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
			FROM ${TRANSFER_SOURCE_ALIAS}.${spec.table} s
			JOIN main.${spec.table} d ON ${joinCondition}
		`);

		// Every source row must resolve to a destination id — concat maps
		// unconditionally (no needed-set filter), so `xfer_map_<table>`
		// must cover every row of the attached source's own table. A gap
		// here means the natural-key JOIN above failed to match a row this
		// same function just inserted, which should be impossible; treat it
		// as a hard integrity failure rather than let a missing map entry
		// surface later as a confusing NULL FK deep in an unrelated table.
		const sourceCountRows = await trx(`${TRANSFER_SOURCE_ALIAS}.${spec.table}`).count<
			{ sourceCount: number }[]
		>({ sourceCount: '*' });
		const mappedCountRows = await trx(`xfer_map_${spec.table}`).count<
			{ mappedCount: number }[]
		>({ mappedCount: '*' });
		const sourceCount = sourceCountRows[0]?.sourceCount ?? 0;
		const mappedCount = mappedCountRows[0]?.mappedCount ?? 0;
		if (Number(mappedCount) !== Number(sourceCount)) {
			throw new TransferIntegrityError(
				`copyDictionariesForConcat: ${spec.table} has ${sourceCount} source row(s) but only ${mappedCount} mapped to a destination id`,
			);
		}
	}
}
