import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateInventoryRunsInvalidSkipped } from './migrate-inventory-runs-invalid-skipped.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `inventory_runs` exists but has no
 * `invalid_skipped` column.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance.
 */
async function buildLegacyInventoryRuns(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('inventory_runs', (t) => {
		t.increments('id');
		t.string('ran_at').notNullable();
		t.integer('scope_skipped').nullable();
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-test.sqlite',
		'migrate-idempotent.sqlite',
		'migrate-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateInventoryRunsInvalidSkipped', () => {
	it('adds the invalid_skipped column to an existing inventory_runs table', async () => {
		const { instance } = await buildLegacyInventoryRuns('migrate-test.sqlite');
		await instance('inventory_runs').insert({
			ran_at: '2026-01-01T00:00:00Z',
			scope_skipped: 3,
		});

		await migrateInventoryRunsInvalidSkipped(instance);

		expect(await instance.schema.hasColumn('inventory_runs', 'invalid_skipped')).toBe(
			true,
		);

		// Pre-existing row and columns survive untouched, new column is NULL.
		const [row] = await instance
			.select('ran_at', 'scope_skipped', 'invalid_skipped')
			.from('inventory_runs');
		expect(row.ran_at).toBe('2026-01-01T00:00:00Z');
		expect(row.scope_skipped).toBe(3);
		expect(row.invalid_skipped).toBeNull();

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyInventoryRuns('migrate-idempotent.sqlite');

		await migrateInventoryRunsInvalidSkipped(instance);
		await expect(migrateInventoryRunsInvalidSkipped(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('inventory_runs', 'invalid_skipped')).toBe(
			true,
		);

		await instance.destroy();
	});

	it('returns silently when inventory_runs does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migrateInventoryRunsInvalidSkipped(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
