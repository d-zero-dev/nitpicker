import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { closeNetworkOutage } from './close-network-outage.js';
import { insertNetworkOutage } from './insert-network-outage.js';

describe('closeNetworkOutage', () => {
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

	it('sets ended_at on the target row, leaving every other column untouched', async () => {
		const id = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		const before = await db('network_outages').where({ id }).first();

		await closeNetworkOutage(db, id, 9999);

		const after = await db('network_outages').where({ id }).first();
		expect(after.ended_at).toBe(9999);
		expect(after.started_at).toBe(before.started_at);
		expect(after.detected_at).toBe(before.detected_at);
		expect(after.probe_host).toBe(before.probe_host);
		expect(after.trigger_error_count).toBe(before.trigger_error_count);
		expect(after.trigger_host_count).toBe(before.trigger_host_count);
	});

	it('is idempotent — closing an already-closed row a second time does not change ended_at', async () => {
		const id = await insertNetworkOutage(db, {
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await closeNetworkOutage(db, id, 9999);
		await closeNetworkOutage(db, id, 12_345);

		const row = await db('network_outages').where({ id }).first();
		expect(row.ended_at).toBe(9999);
	});

	it('does not affect a different, still-open outage row', async () => {
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
			triggerErrorCount: 3,
			triggerHostCount: 2,
		});

		await closeNetworkOutage(db, firstId, 9999);

		const secondRow = await db('network_outages').where({ id: secondId }).first();
		expect(secondRow.ended_at).toBeNull();
	});
});
