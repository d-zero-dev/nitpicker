import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateInventoryRunsToListReconcileRuns } from './migrate-inventory-runs-to-list-reconcile-runs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating the rename: `inventory_runs` exists under its old name.
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
		t.string('list_label').nullable();
		t.integer('scope_skipped').nullable();
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-rename-test.sqlite',
		'migrate-rename-idempotent.sqlite',
		'migrate-rename-empty.sqlite',
		'migrate-rename-already-done.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateInventoryRunsToListReconcileRuns', () => {
	it('renames inventory_runs to list_reconcile_runs, preserving rows', async () => {
		const { instance } = await buildLegacyInventoryRuns('migrate-rename-test.sqlite');
		await instance('inventory_runs').insert({
			ran_at: '2026-01-01T00:00:00Z',
			list_label: 'inventory-2026-01-01T00:00:00Z',
			scope_skipped: 3,
		});

		await migrateInventoryRunsToListReconcileRuns(instance);

		expect(await instance.schema.hasTable('inventory_runs')).toBe(false);
		expect(await instance.schema.hasTable('list_reconcile_runs')).toBe(true);

		const [row] = await instance
			.select('ran_at', 'list_label', 'scope_skipped')
			.from('list_reconcile_runs');
		expect(row.ran_at).toBe('2026-01-01T00:00:00Z');
		expect(row.list_label).toBe('inventory-2026-01-01T00:00:00Z');
		expect(row.scope_skipped).toBe(3);

		await instance.destroy();
	});

	it('is idempotent — calling twice only renames once', async () => {
		const { instance } = await buildLegacyInventoryRuns(
			'migrate-rename-idempotent.sqlite',
		);

		await migrateInventoryRunsToListReconcileRuns(instance);
		await expect(
			migrateInventoryRunsToListReconcileRuns(instance),
		).resolves.toBeUndefined();

		expect(await instance.schema.hasTable('list_reconcile_runs')).toBe(true);

		await instance.destroy();
	});

	it('returns silently when inventory_runs does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-rename-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(
			migrateInventoryRunsToListReconcileRuns(instance),
		).resolves.toBeUndefined();

		await instance.destroy();
	});

	it('returns silently when list_reconcile_runs already exists (fresh archive shape)', async () => {
		const filename = path.resolve(workingDir, 'migrate-rename-already-done.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		await instance.schema.createTable('list_reconcile_runs', (t) => {
			t.increments('id');
			t.string('ran_at').notNullable();
		});

		await expect(
			migrateInventoryRunsToListReconcileRuns(instance),
		).resolves.toBeUndefined();
		expect(await instance.schema.hasTable('list_reconcile_runs')).toBe(true);

		await instance.destroy();
	});
});
