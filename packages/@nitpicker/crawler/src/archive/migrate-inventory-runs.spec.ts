import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateInventoryRuns } from './migrate-inventory-runs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file simulating an archive that
 * has a `pages` table (the marker used by every migration to distinguish
 * "real archive" from "empty file") but no `inventory_runs` yet.
 * @param fileName - SQLite file name relative to {@link workingDir}.
 * @returns Connected knex instance + file path for cleanup.
 */
async function buildLegacyArchive(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-inventory-runs.sqlite',
		'migrate-inventory-runs-idempotent.sqlite',
		'migrate-inventory-runs-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateInventoryRuns', () => {
	it('creates inventory_runs with the expected columns when the table is missing', async () => {
		const { instance } = await buildLegacyArchive('migrate-inventory-runs.sqlite');

		await migrateInventoryRuns(instance);

		expect(await instance.schema.hasTable('inventory_runs')).toBe(true);
		// All 10 columns of the Phase 1 schema. Listed individually so a
		// rename / drop in the implementation surfaces as a single column
		// failure rather than a generic "table mismatch".
		expect(await instance.schema.hasColumn('inventory_runs', 'id')).toBe(true);
		expect(await instance.schema.hasColumn('inventory_runs', 'ran_at')).toBe(true);
		expect(await instance.schema.hasColumn('inventory_runs', 'list_label')).toBe(true);
		expect(await instance.schema.hasColumn('inventory_runs', 'source_file_path')).toBe(
			true,
		);
		expect(await instance.schema.hasColumn('inventory_runs', 'source_file_sha256')).toBe(
			true,
		);
		expect(await instance.schema.hasColumn('inventory_runs', 'total_lines')).toBe(true);
		expect(await instance.schema.hasColumn('inventory_runs', 'new_pages')).toBe(true);
		expect(await instance.schema.hasColumn('inventory_runs', 'new_resources')).toBe(true);
		expect(await instance.schema.hasColumn('inventory_runs', 'scope_skipped')).toBe(true);
		expect(await instance.schema.hasColumn('inventory_runs', 'notes')).toBe(true);

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyArchive(
			'migrate-inventory-runs-idempotent.sqlite',
		);

		await migrateInventoryRuns(instance);
		// Insert a marker row so the second run is observable as a no-op
		// (data preserved, schema untouched).
		await instance('inventory_runs').insert({
			ran_at: '2026-06-21T11:30:00+09:00',
			list_label: 'idempotency-marker',
			total_lines: 42,
		});

		await migrateInventoryRuns(instance);

		const [row] = await instance('inventory_runs').select(
			'ran_at',
			'list_label',
			'total_lines',
		);
		expect(row.ran_at).toBe('2026-06-21T11:30:00+09:00');
		expect(row.list_label).toBe('idempotency-marker');
		expect(row.total_lines).toBe(42);

		await instance.destroy();
	});

	it('exits without writing when the archive predates the pages table entirely', async () => {
		// Empty file — no migration should touch it. The regular `initSchema`
		// path creates `inventory_runs` alongside the other tables at first
		// crawl; bare migration runs against legacy archives only.
		const filename = path.resolve(workingDir, 'migrate-inventory-runs-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await migrateInventoryRuns(instance);

		expect(await instance.schema.hasTable('inventory_runs')).toBe(false);

		await instance.destroy();
	});
});
