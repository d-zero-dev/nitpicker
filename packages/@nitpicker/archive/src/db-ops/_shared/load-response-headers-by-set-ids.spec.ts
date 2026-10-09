import type { Knex } from 'knex';

import knex from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { loadResponseHeadersBySetIds } from './load-response-headers-by-set-ids.js';

/**
 * Inserts one header set with the given (name, value, occurrence) entries
 * and returns its id. Hashes are synthetic per-set fillers — this spec
 * exercises the read-back merge, not the dedup identity.
 * @param db - Knex instance.
 * @param seed - Unique per-set marker used to build the synthetic hashes.
 * @param entries - Entries to insert.
 * @returns The `header_sets.id`.
 */
async function insertHeaderSet(
	db: Knex,
	seed: string,
	entries: { name: string; value: string; occurrence: number }[],
): Promise<number> {
	const [setRow] = await db('header_sets')
		.insert({
			raw_json_hash: Buffer.from(`raw-json-${seed}`.padEnd(32, 'x')),
			raw_hash: Buffer.from(`raw-${seed}`.padEnd(32, 'x')),
			stable_hash: Buffer.from(`stable-${seed}`.padEnd(32, 'x')),
			volatile_hash: null,
			entry_count: entries.length,
			stable_entry_count: entries.length,
		})
		.returning('id');
	for (const entry of entries) {
		await db('header_name_refs').insert({ name: entry.name }).onConflict('name').ignore();
		const nameRow = await db('header_name_refs')
			.select('id')
			.where('name', entry.name)
			.first();
		const valueHash = Buffer.from(`v-${entry.value}`.padEnd(32, 'y'));
		await db('header_value_refs')
			.insert({ hash: valueHash, value: entry.value })
			.onConflict(['hash', 'value'])
			.ignore();
		const valueRow = await db('header_value_refs')
			.select('id')
			.where({ value: entry.value })
			.first();
		await db('header_set_entries').insert({
			header_set_id: setRow.id,
			name_id: nameRow!.id,
			occurrence: entry.occurrence,
			value_id: valueRow!.id,
			is_volatile: 0,
		});
	}
	return setRow.id;
}

describe('loadResponseHeadersBySetIds', () => {
	let db: Knex;

	beforeAll(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
	});

	afterAll(async () => {
		await db.destroy();
	});

	it('returns an empty map for empty input without querying', async () => {
		const result = await loadResponseHeadersBySetIds(db, []);
		expect(result.size).toBe(0);
	});

	it('merges multi-value headers with ", " in occurrence order', async () => {
		const setId = await insertHeaderSet(db, 'multi', [
			{ name: 'set-cookie', value: 'a=1', occurrence: 1 },
			{ name: 'set-cookie', value: 'b=2', occurrence: 2 },
			{ name: 'content-type', value: 'text/html', occurrence: 1 },
		]);
		const result = await loadResponseHeadersBySetIds(db, [setId]);
		expect(result.get(setId)).toEqual({
			'set-cookie': 'a=1, b=2',
			'content-type': 'text/html',
		});
	});

	it('loads more set ids than one lookup chunk holds without dropping any', async () => {
		// 900 sets exceeds the 800-per-chunk lookup size, forcing at least
		// two chunked SELECTs. Every set must come back with its own value.
		const setIds: number[] = [];
		const BULK = 900;
		// Bulk-build the dictionary rows first, then entries, to keep this
		// fixture fast (per-set insertHeaderSet would issue ~5 queries each).
		const nameId = await (async () => {
			await db('header_name_refs').insert({ name: 'x-bulk' }).onConflict('name').ignore();
			return (await db('header_name_refs').select('id').where('name', 'x-bulk').first())!
				.id as number;
		})();
		for (let index = 0; index < BULK; index += 300) {
			const chunkSets = [];
			for (let n = index; n < Math.min(index + 300, BULK); n++) {
				chunkSets.push({
					raw_json_hash: Buffer.from(`bulk-json-${n}`.padEnd(32, 'x')),
					raw_hash: Buffer.from(`bulk-raw-${n}`.padEnd(32, 'x')),
					stable_hash: Buffer.from(`bulk-stable-${n}`.padEnd(32, 'x')),
					volatile_hash: null,
					entry_count: 1,
					stable_entry_count: 1,
				});
			}
			const inserted = await db('header_sets').insert(chunkSets).returning('id');
			setIds.push(...inserted.map((r: { id: number }) => r.id));
		}
		const valueRows: { hash: Buffer; value: string }[] = setIds.map((id) => ({
			hash: Buffer.from(`bulk-v-${id}`.padEnd(32, 'y')),
			value: `value-${id}`,
		}));
		for (let index = 0; index < valueRows.length; index += 300) {
			await db('header_value_refs').insert(valueRows.slice(index, index + 300));
		}
		const allValueRows: { id: number; value: string }[] = await db(
			'header_value_refs',
		).select('id', 'value');
		const valueIdByValue = new Map<string, number>(
			allValueRows.map((r) => [r.value, r.id]),
		);
		const entryRows = setIds.map((id) => ({
			header_set_id: id,
			name_id: nameId,
			occurrence: 1,
			value_id: valueIdByValue.get(`value-${id}`)!,
			is_volatile: 0,
		}));
		for (let index = 0; index < entryRows.length; index += 300) {
			await db('header_set_entries').insert(entryRows.slice(index, index + 300));
		}

		const result = await loadResponseHeadersBySetIds(db, setIds);
		expect(result.size).toBe(BULK);
		expect(result.get(setIds[0]!)).toEqual({ 'x-bulk': `value-${setIds[0]}` });
		expect(result.get(setIds.at(-1)!)).toEqual({ 'x-bulk': `value-${setIds.at(-1)}` });
	});
});
