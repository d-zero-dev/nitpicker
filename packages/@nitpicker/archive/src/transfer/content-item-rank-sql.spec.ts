import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from '../libsql-dialect.js';

import { contentItemRankSql } from './content-item-rank-sql.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const filename = path.resolve(workingDir, 'content-item-rank-sql-test.sqlite');

afterEach(async () => {
	await fs.rm(filename, { force: true });
});

describe('contentItemRankSql', () => {
	it('ranks scraped internal (2) above scraped external (1) above unscraped (0)', async () => {
		const db = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		await db.schema.createTable('t', (t) => {
			t.increments('id');
			t.integer('scraped').notNullable();
			t.integer('is_external').notNullable();
		});
		await db('t').insert([
			{ id: 1, scraped: 1, is_external: 0 }, // internal, scraped -> 2
			{ id: 2, scraped: 1, is_external: 1 }, // external, scraped -> 1
			{ id: 3, scraped: 0, is_external: 0 }, // unscraped internal -> 0
			{ id: 4, scraped: 0, is_external: 1 }, // unscraped external (anomaly) -> 0
		]);

		const rows = await db
			.select('id')
			.select(db.raw(`${contentItemRankSql('t')} as rank`))
			.from('t')
			.orderBy('id');

		expect(rows).toEqual([
			{ id: 1, rank: 2 },
			{ id: 2, rank: 1 },
			{ id: 3, rank: 0 },
			{ id: 4, rank: 0 },
		]);
		await db.destroy();
	});
});
