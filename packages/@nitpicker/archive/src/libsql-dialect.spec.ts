import type { Knex } from 'knex';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import knex from 'knex';
import libsql from 'libsql';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';

describe('LibsqlDialect', () => {
	it('Knex の better-sqlite3 dialect の driverName を継承する', () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		expect(db.client.driverName).toBe('better-sqlite3');
		return db.destroy();
	});

	it('_driver() が libsql コンストラクタを返す', () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		expect(db.client._driver()).toBe(libsql);
		return db.destroy();
	});

	it('libsql バイナリで実 SQL を実行できる', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await db.schema.createTable('t', (t) => {
			t.increments('id');
			t.string('name');
		});
		await db('t').insert({ name: 'a' });
		const rows = await db('t').select('*');
		expect(rows).toEqual([{ id: 1, name: 'a' }]);
		await db.destroy();
	});
});

describe('LibsqlDialect の ROLLBACK 取り扱い', () => {
	interface FakeQuery {
		sql?: string;
		response?: unknown;
		context?: unknown;
	}

	/**
	 * `prepare()` が呼ばれたら throw する偽の接続。SQL が実際に実行されたかを検出する。
	 * @param extra - 接続に足すプロパティ（`inTransaction` など）
	 */
	function createFakeConnection(extra: Record<string, unknown>) {
		const prepared: string[] = [];
		return {
			prepared,
			connection: {
				...extra,
				prepare(sql: string) {
					prepared.push(sql);
					throw new Error(`prepared: ${sql}`);
				},
			},
		};
	}

	/**
	 * `Knex.Client` の型宣言に無い `_query` を、偽の接続に対して呼ぶ。
	 *
	 * `transacting` は knex がトランザクション用に派生させるクライアントだけが `true` で持つ
	 * 内部フィールド（`makeTxClient`）。ここでは単体で切り替えるために直接書き換える。実際の
	 * トランザクション経路でその前提が成り立つことは、下の実ファイル DB のテストが押さえる。
	 * @param connection - 偽の接続（`undefined` で接続なしを模す）
	 * @param query - 実行するクエリ
	 * @param transacting - トランザクション用クライアントとして呼ぶか
	 */
	function runQuery(
		connection: unknown,
		query: FakeQuery,
		transacting = true,
	): Promise<FakeQuery> {
		const client = unitDb.client as unknown as {
			transacting?: boolean;
			_query(connection: unknown, query: FakeQuery): Promise<FakeQuery>;
		};
		client.transacting = transacting;
		return client._query(connection, query);
	}

	let unitDb: Knex;

	beforeAll(() => {
		unitDb = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
	});

	afterAll(async () => {
		await unitDb.destroy();
	});

	it('トランザクション用でないクライアントの ROLLBACK は inTransaction が false でも実行する', async () => {
		const { prepared, connection } = createFakeConnection({ inTransaction: false });
		await expect(runQuery(connection, { sql: 'ROLLBACK' }, false)).rejects.toThrow(
			'prepared: ROLLBACK',
		);
		expect(prepared).toEqual(['ROLLBACK']);
	});

	it('トランザクションが SQLite に終了済み（inTransaction が false）の ROLLBACK は実行せず成功する', async () => {
		const { prepared, connection } = createFakeConnection({ inTransaction: false });
		const result = await runQuery(connection, { sql: 'ROLLBACK' });
		expect(prepared).toEqual([]);
		expect(result.response).toEqual({ changes: 0, lastInsertRowid: 0 });
		expect(result.context).toEqual({ lastID: 0, changes: 0 });
	});

	it('ROLLBACK TO SAVEPOINT も inTransaction が false なら実行せず成功する', async () => {
		const { prepared, connection } = createFakeConnection({ inTransaction: false });
		const result = await runQuery(connection, { sql: 'ROLLBACK TO SAVEPOINT trx1' });
		expect(prepared).toEqual([]);
		expect(result.response).toEqual({ changes: 0, lastInsertRowid: 0 });
		expect(result.context).toEqual({ lastID: 0, changes: 0 });
	});

	it('小文字の rollback も同じ扱いにする（knex 本体の判定と同じ大文字小文字無視）', async () => {
		const { prepared, connection } = createFakeConnection({ inTransaction: false });
		await runQuery(connection, { sql: 'rollback' });
		expect(prepared).toEqual([]);
	});

	it('先頭に空白のある ROLLBACK は knex 本体の判定と同じく対象にせず、実行する', async () => {
		const { prepared, connection } = createFakeConnection({ inTransaction: false });
		await expect(runQuery(connection, { sql: ' ROLLBACK' })).rejects.toThrow(
			'prepared:  ROLLBACK',
		);
		expect(prepared).toEqual([' ROLLBACK']);
	});

	it('トランザクション中（inTransaction が true）の ROLLBACK は実行する', async () => {
		const { prepared, connection } = createFakeConnection({ inTransaction: true });
		await expect(runQuery(connection, { sql: 'ROLLBACK' })).rejects.toThrow(
			'prepared: ROLLBACK',
		);
		expect(prepared).toEqual(['ROLLBACK']);
	});

	it('inTransaction を持たない接続の ROLLBACK は実行する', async () => {
		const { prepared, connection } = createFakeConnection({});
		await expect(runQuery(connection, { sql: 'ROLLBACK' })).rejects.toThrow(
			'prepared: ROLLBACK',
		);
		expect(prepared).toEqual(['ROLLBACK']);
	});

	it.each(['BEGIN;', 'SELECT 1', 'COMMIT;'])(
		'inTransaction が false でも ROLLBACK 以外（%s）は実行する',
		async (sql) => {
			const { prepared, connection } = createFakeConnection({ inTransaction: false });
			await expect(runQuery(connection, { sql })).rejects.toThrow(`prepared: ${sql}`);
			expect(prepared).toEqual([sql]);
		},
	);

	it.each(['ROLLBACK;', 'ROLLBACK TO SAVEPOINT trx2;', 'ROLLBACK TO trx2'])(
		'inTransaction が false なら %s も実行せず成功する',
		async (sql) => {
			const { prepared, connection } = createFakeConnection({ inTransaction: false });
			await runQuery(connection, { sql });
			expect(prepared).toEqual([]);
		},
	);

	it('接続が無いときは No connection provided を返す', async () => {
		await expect(runQuery(undefined, { sql: 'ROLLBACK' })).rejects.toThrow(
			'No connection provided',
		);
	});

	it.each([{ sql: '' }, {}])(
		'SQL が空のときは The query is empty を返す（%o）',
		async (query) => {
			const { prepared, connection } = createFakeConnection({ inTransaction: false });
			await expect(runQuery(connection, query)).rejects.toThrow('The query is empty');
			expect(prepared).toEqual([]);
		},
	);

	describe('実ファイル DB のトランザクション', () => {
		let dir: string;
		let db: Knex | undefined;

		beforeEach(async () => {
			dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-libsql-dialect-'));
		});

		afterEach(async () => {
			await db?.destroy();
			db = undefined;
			await fs.rm(dir, { recursive: true, force: true });
		});

		/**
		 * `t` テーブルを持つファイル DB を開く。プールは 1 接続（sqlite dialect の既定）で、
		 * PRAGMA とトランザクションが同じ接続に効くことを前提にする。
		 */
		async function openDb(): Promise<Knex> {
			db = knex({
				client: LibsqlDialect,
				connection: { filename: path.join(dir, 'test.sqlite') },
				useNullAsDefault: true,
				pool: { min: 1, max: 1 },
			});
			await db.raw('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
			return db;
		}

		/**
		 * ページキャッシュを小さく、ファイルサイズ上限を低くして、トランザクションの途中で
		 * `SQLITE_FULL` を起こせるようにする。SQLite はこのエラーでトランザクション全体を自動で
		 * 巻き戻すことがある（https://www.sqlite.org/lang_transaction.html "Response To Errors
		 * Within A Transaction"）。巻き戻すかは SQLite の実装次第なので、下のテストは巻き戻しが
		 * 実際に起きたこと（`inTransaction` が false、ROLLBACK が SQLite に送られていない）も
		 * 検証する。起きない版では、前提が崩れたことが assertion の失敗で分かる。
		 * @param target - 対象の DB
		 */
		async function limitStorage(target: Knex): Promise<void> {
			await target.raw('PRAGMA cache_size = 10');
			await target.raw('PRAGMA max_page_count = 200');
		}

		/**
		 * 接続の `prepare` を差し替えて、SQLite に実際に渡った SQL を記録する。
		 * @param target - 対象の DB
		 */
		async function trackExecuted(target: Knex) {
			const connection = await target.client.acquireConnection();
			const executed: string[] = [];
			const originalPrepare = connection.prepare.bind(connection);
			connection.prepare = (sql: string) => {
				executed.push(sql);
				return originalPrepare(sql);
			};
			target.client.releaseConnection(connection);
			return { connection, executed };
		}

		/**
		 * 1 行 500 文字の INSERT を大量に発行して、ファイルサイズ上限に到達させる。
		 * @param trx - INSERT を発行するトランザクション
		 */
		async function insertUntilFull(trx: Knex.Transaction): Promise<void> {
			for (let i = 0; i < 5000; i++) {
				await trx.raw('INSERT INTO t (v) VALUES (?)', ['x'.repeat(500)]);
			}
		}

		it('SQLITE_FULL で自動ロールバックされても、呼び出し側に元の例外が届く', async () => {
			const target = await openDb();
			const queryErrors: { code?: string; message: string }[] = [];
			target.on('query-error', (error: { code?: string; message: string }) => {
				queryErrors.push(error);
			});
			await limitStorage(target);
			const { connection, executed } = await trackExecuted(target);

			const run = target.transaction(insertUntilFull);

			await expect(run).rejects.toMatchObject({
				code: 'SQLITE_FULL',
				message: expect.stringContaining('database or disk is full'),
			});
			expect(queryErrors.map((error) => error.code)).toEqual(['SQLITE_FULL']);
			// 仕掛けが生きている（INSERT が観測できている）うえで、ROLLBACK は SQLite に送られていない
			expect(executed.length).toBeGreaterThan(0);
			expect(executed.filter((sql) => /^ROLLBACK\b/i.test(sql))).toEqual([]);
			// 自動で巻き戻され、接続にトランザクションが残らない
			expect(connection.inTransaction).toBe(false);
			expect(await target('t').count({ count: '*' })).toEqual([{ count: 0 }]);
		});

		it('ネストしたトランザクションの内側で自動ロールバックされても、元の例外が外側にも届く', async () => {
			const target = await openDb();
			const queryErrors: { code?: string; message: string }[] = [];
			target.on('query-error', (error: { code?: string; message: string }) => {
				queryErrors.push(error);
			});
			await limitStorage(target);
			const { connection, executed } = await trackExecuted(target);

			const run = target.transaction(async (outer) => {
				await outer.raw("INSERT INTO t (v) VALUES ('outer')");
				await outer.transaction(insertUntilFull);
			});

			await expect(run).rejects.toMatchObject({ code: 'SQLITE_FULL' });
			expect(queryErrors.map((error) => error.code)).toEqual(['SQLITE_FULL']);
			expect(executed.filter((sql) => /^ROLLBACK\b/i.test(sql))).toEqual([]);
			expect(connection.inTransaction).toBe(false);
			expect(await target('t').count({ count: '*' })).toEqual([{ count: 0 }]);
		});

		it('自動ロールバックされない失敗では ROLLBACK を発行し、元の例外が届く', async () => {
			const target = await openDb();
			const { executed } = await trackExecuted(target);

			const run = target.transaction(async (trx) => {
				await trx.raw("INSERT INTO t (v) VALUES ('a')");
				throw new Error('original failure');
			});

			await expect(run).rejects.toThrow('original failure');
			expect(executed).toContain('ROLLBACK');
			expect(await target('t').count({ count: '*' })).toEqual([{ count: 0 }]);
		});
	});
});
