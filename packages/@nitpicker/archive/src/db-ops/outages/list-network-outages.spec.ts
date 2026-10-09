import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { closeNetworkOutage } from './close-network-outage.js';
import { insertNetworkOutage } from './insert-network-outage.js';
import { listNetworkOutages } from './list-network-outages.js';

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

describe('listNetworkOutages', () => {
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

	it('returns an empty array when the table has no rows — identical to today for every existing archive', async () => {
		expect(await listNetworkOutages(db)).toEqual([]);
	});

	it('returns [] on an archive that predates the network_outages table', async () => {
		await db.schema.dropTableIfExists('network_outages');
		expect(await listNetworkOutages(db)).toEqual([]);
	});

	it('returns a closed row as-is', async () => {
		const id = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await closeNetworkOutage(db, id, 1500);

		const windows = await listNetworkOutages(db);
		expect(windows).toEqual([{ startedAt: 100, endedAt: 1500 }]);
	});

	it('resolves a still-open row using the clamp instead of leaving it unbounded', async () => {
		await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await insertPageRow(db, 'https://a.example/ok', 4000);

		const windows = await listNetworkOutages(db);
		expect(windows).toEqual([{ startedAt: 100, endedAt: 4000 }]);
	});

	it('never leaves an open row unbounded even with zero other archive activity', async () => {
		// No crawl_errors, no content_items rows at all — the clamp falls
		// back to 0, but Math.max(clamp, startedAt) still produces a finite,
		// closed window rather than treating the row as infinite.
		await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: null,
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});

		const windows = await listNetworkOutages(db);
		expect(windows).toEqual([{ startedAt: 100, endedAt: 100 }]);
	});

	it('returns multiple windows, mixing closed and resolved-open rows', async () => {
		const firstId = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await closeNetworkOutage(db, firstId, 1500);
		await insertNetworkOutage(db, {
			startedAt: 5000,
			detectedAt: 5100,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await insertPageRow(db, 'https://a.example/ok', 9000);

		const windows = await listNetworkOutages(db);
		expect(windows).toHaveLength(2);
		expect(windows).toContainEqual({ startedAt: 100, endedAt: 1500 });
		expect(windows).toContainEqual({ startedAt: 5000, endedAt: 9000 });
	});
});
