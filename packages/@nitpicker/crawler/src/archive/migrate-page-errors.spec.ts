import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migratePageErrors } from './migrate-page-errors.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Builds a knex instance against a temp SQLite file that simulates an old
 * archive: the `pages` table exists but `page_errors` does not yet.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance + the file path so callers can clean
 *   it up.
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
		'migrate-page-errors.sqlite',
		'migrate-page-errors-idempotent.sqlite',
		'migrate-page-errors-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migratePageErrors', () => {
	it('creates page_errors with the expected columns when the table is missing', async () => {
		const { instance } = await buildLegacyArchive('migrate-page-errors.sqlite');

		await migratePageErrors(instance);

		expect(await instance.schema.hasTable('page_errors')).toBe(true);
		expect(await instance.schema.hasColumn('page_errors', 'id')).toBe(true);
		expect(await instance.schema.hasColumn('page_errors', 'pageId')).toBe(true);
		expect(await instance.schema.hasColumn('page_errors', 'phase')).toBe(true);
		expect(await instance.schema.hasColumn('page_errors', 'message')).toBe(true);
		expect(await instance.schema.hasColumn('page_errors', 'createdAt')).toBe(true);

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyArchive(
			'migrate-page-errors-idempotent.sqlite',
		);

		await migratePageErrors(instance);
		// Insert a marker row so the second run can be observed not to touch data.
		await instance('pages').insert({ url: 'https://example.com/' });
		const [page] = await instance('pages').select('id', 'url');
		await instance('page_errors').insert({
			pageId: page.id,
			phase: 'retryExhausted',
			message: '📷 mobile-small: skipped — Attempted to use detached Frame',
			createdAt: 1_700_000_000_000,
		});

		await migratePageErrors(instance);

		const [row] = await instance('page_errors').select('phase', 'message');
		expect(row.phase).toBe('retryExhausted');
		expect(row.message).toBe(
			'📷 mobile-small: skipped — Attempted to use detached Frame',
		);

		await instance.destroy();
	});

	it('exits without writing when the archive predates the pages table entirely', async () => {
		// An entirely empty archive — no migration should touch it. The regular
		// initSchema path is responsible for creating both tables at once.
		const filename = path.resolve(workingDir, 'migrate-page-errors-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await migratePageErrors(instance);

		expect(await instance.schema.hasTable('page_errors')).toBe(false);

		await instance.destroy();
	});
});
