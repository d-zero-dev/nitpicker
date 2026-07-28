import type { ConsoleLogItemRow } from './types.js';
import type { WriteRefCaches } from '../_shared/types.js';
import type { Knex } from 'knex';

/**
 * Resolves the `console_log_items.id` for one console log entry's content,
 * inserting the dictionary row when the hash is not yet known.
 *
 * Same no-op-update-for-`RETURNING` idiom as `upsertUrlRef` / `upsertJsonRef`:
 * `INSERT ... ON CONFLICT(hash) DO UPDATE SET hash = hash RETURNING id`
 * yields the existing row's id on a hash collision without a separate
 * SELECT round trip, and (unlike `INSERT OR IGNORE ... RETURNING`) still
 * returns a row when the insert itself is the no-op.
 * @param qb - Knex instance or transaction connected to the archive DB.
 * @param caches - The connection's write-side id caches; mutated in place.
 * @param row - The content hash plus every resolved ref id / scalar column.
 * @returns The `console_log_items.id` of the existing or newly inserted row.
 * @example
 * const id = await upsertConsoleLogItem(trx, caches, {
 *   hash: computeConsoleLogHash(entry),
 *   type: entry.type,
 *   textId,
 *   argsJsonId: null,
 *   locUrlId: null,
 *   locLine: null,
 *   locColumn: null,
 *   stackTextId: null,
 * });
 */
export async function upsertConsoleLogItem(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	row: ConsoleLogItemRow,
): Promise<number> {
	const hex = row.hash.toString('hex');
	const cached = caches.consoleLogIds.get(hex);
	if (cached !== undefined) {
		return cached;
	}
	const rows: { id: number }[] = await qb.raw(
		`INSERT INTO console_log_items
			(hash, type, text_id, args_json_id, loc_url_id, loc_line, loc_column, stack_text_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(hash) DO UPDATE SET hash = hash
		 RETURNING id`,
		[
			row.hash,
			row.type,
			row.textId,
			row.argsJsonId,
			row.locUrlId,
			row.locLine,
			row.locColumn,
			row.stackTextId,
		],
	);
	const first = rows[0];
	if (first === undefined) {
		throw new Error('upsertConsoleLogItem: RETURNING yielded no row');
	}
	caches.consoleLogIds.set(hex, first.id);
	return first.id;
}
