import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { closeStaleOpenNetworkOutages } from './close-stale-open-network-outages.js';
import { insertNetworkOutage } from './insert-network-outage.js';

/**
 *
 * @param db
 * @param url
 * @param lastCrawledAt
 */
async function insertPageRow(
	db: Knex,
	url: string,
	lastCrawledAt: number | null,
): Promise<void> {
	const [{ id: urlId }] = (await db('url_refs').insert({ url }).returning('id')) as {
		id: number;
	}[];
	await db('content_items').insert({
		url_id: urlId,
		is_external: 0,
		scraped: 1,
		is_target: 1,
		last_crawled_at: lastCrawledAt,
	});
}

describe('closeStaleOpenNetworkOutages', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('does nothing when there are no rows at all', async () => {
		await expect(closeStaleOpenNetworkOutages(db)).resolves.toBeUndefined();
		expect(await db('network_outages').select('*')).toEqual([]);
	});

	it('does nothing when every row is already closed', async () => {
		const id = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await db('network_outages').where({ id }).update({ ended_at: 500 });

		await closeStaleOpenNetworkOutages(db);

		const row = await db('network_outages').where({ id }).first();
		expect(row.ended_at).toBe(500);
	});

	it('closes a crashed-session row using the archive-activity clamp', async () => {
		// Simulates: the crawl process was killed mid-outage, leaving
		// ended_at NULL. On the next writer open, this must durably close
		// the row so downstream readers never see an unbounded window.
		const id = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await insertPageRow(db, 'https://a.example/ok', 4000);

		await closeStaleOpenNetworkOutages(db);

		const row = await db('network_outages').where({ id }).first();
		expect(row.ended_at).toBe(4000);
	});

	it('closes a crashed-session row with zero other archive activity, using startedAt as the floor', async () => {
		const id = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: null,
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});

		await closeStaleOpenNetworkOutages(db);

		const row = await db('network_outages').where({ id }).first();
		expect(row.ended_at).toBe(100);
	});

	it('is idempotent — running it twice does not change an already-finalized value', async () => {
		const id = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await insertPageRow(db, 'https://a.example/ok', 4000);

		await closeStaleOpenNetworkOutages(db);
		const firstRow = await db('network_outages').where({ id }).first();
		const firstEndedAt = firstRow.ended_at;

		// More archive activity happens after the first finalize pass — a
		// second run must NOT reopen or move the already-closed value even
		// though the clamp would now compute a larger number.
		await insertPageRow(db, 'https://a.example/later', 9000);
		await closeStaleOpenNetworkOutages(db);

		const row = await db('network_outages').where({ id }).first();
		expect(row.ended_at).toBe(firstEndedAt);
		expect(row.ended_at).toBe(4000);
	});

	it('closes multiple stale-open rows independently, each with its own clamp-derived value', async () => {
		const firstId = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		const secondId = await insertNetworkOutage(db, {
			startedAt: 5000,
			detectedAt: 5100,
			probeHost: 'b.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await insertPageRow(db, 'https://a.example/ok', 9000);

		await closeStaleOpenNetworkOutages(db);

		const firstRow = await db('network_outages').where({ id: firstId }).first();
		const secondRow = await db('network_outages').where({ id: secondId }).first();
		// Both rows share the same archive-wide clamp (there is only one
		// "latest observed activity" timestamp), applied independently.
		expect(firstRow.ended_at).toBe(9000);
		expect(secondRow.ended_at).toBe(9000);
	});
});
