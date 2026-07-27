import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { insertNetworkOutage } from './insert-network-outage.js';

describe('insertNetworkOutage', () => {
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

	it('inserts exactly one row with ended_at NULL', async () => {
		await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		const rows = await db('network_outages').select('*');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.started_at).toBe(100);
		expect(rows[0]?.detected_at).toBe(200);
		expect(rows[0]?.ended_at).toBeNull();
		expect(rows[0]?.probe_host).toBe('a.example');
		expect(rows[0]?.trigger_error_count).toBe(5);
		expect(rows[0]?.trigger_host_count).toBe(2);
	});

	it('returns the autoincremented id of the new row', async () => {
		const firstId = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: null,
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		const secondId = await insertNetworkOutage(db, {
			startedAt: 300,
			detectedAt: 400,
			probeHost: null,
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		expect(secondId).toBeGreaterThan(firstId);
	});

	it('stores a null probe_host as-is (no probe target was available)', async () => {
		await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: null,
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		const rows = await db('network_outages').select('probe_host');
		expect(rows[0]?.probe_host).toBeNull();
	});

	it('allows a second, independent outage to be inserted (consecutive outages)', async () => {
		await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await insertNetworkOutage(db, {
			startedAt: 5000,
			detectedAt: 5100,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		const rows = await db('network_outages').select('*');
		expect(rows).toHaveLength(2);
	});
});
