import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../create-adjunct-tables.js';
import { createEntityTables } from '../create-entity-tables.js';
import { createRefTables } from '../create-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { checkForeignKeyIntegrity } from './check-foreign-key-integrity.js';
import { MigrationVerificationError } from './types.js';

describe('checkForeignKeyIntegrity', () => {
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

	it('passes on a consistent archive', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [item] = await db('content_items')
			.insert({ url_id: urlRef.id, scraped: 1, is_target: 1, is_external: 0 })
			.returning('id');
		await db('page_errors').insert({
			pageId: item.id,
			phase: 'render',
			message: 'partial failure',
			createdAt: 0,
		});
		await expect(checkForeignKeyIntegrity(db)).resolves.toBeUndefined();
	});

	it('passes on an empty archive', async () => {
		await expect(checkForeignKeyIntegrity(db)).resolves.toBeUndefined();
	});

	it('detects a dangling row in any FK-bearing table (technology_signals)', async () => {
		await db.raw('PRAGMA foreign_keys = OFF');
		await db('technology_signals').insert({
			pageId: 99_999,
			technology: 'WordPress',
			signalType: 'wappalyzer',
			weight: 60,
		});
		let thrown: unknown = null;
		try {
			await checkForeignKeyIntegrity(db);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(MigrationVerificationError);
		expect((thrown as MigrationVerificationError).details.context).toMatchObject({
			first_offending_table: 'technology_signals',
			first_offending_parent: 'content_items',
		});
	});

	it('throws MigrationVerificationError with the offending table pair on a violation', async () => {
		// Disable enforcement so the dangling row can be inserted —
		// mirroring the migration script's drop phase, where enforcement is
		// OFF and only `PRAGMA foreign_key_check` can catch the violation.
		await db.raw('PRAGMA foreign_keys = OFF');
		await db('page_errors').insert({
			pageId: 99_999,
			phase: 'render',
			message: 'dangling',
			createdAt: 0,
		});
		let thrown: unknown = null;
		try {
			await checkForeignKeyIntegrity(db);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(MigrationVerificationError);
		const details = (thrown as MigrationVerificationError).details;
		expect(details.check).toBe('foreign_key_check');
		expect(details.context).toMatchObject({
			violation_count: 1,
			first_offending_table: 'page_errors',
			first_offending_parent: 'content_items',
		});
	});
});
