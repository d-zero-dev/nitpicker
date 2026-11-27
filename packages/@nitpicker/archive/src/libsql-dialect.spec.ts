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

	it('libsql の接続は inTransaction を公開し、BEGIN と COMMIT で切り替わる', () => {
		const connection = new libsql(':memory:');
		try {
			expect(connection.inTransaction).toBe(false);
			connection.prepare('BEGIN').run();
			expect(connection.inTransaction).toBe(true);
			connection.prepare('COMMIT').run();
			expect(connection.inTransaction).toBe(false);
		} finally {
			connection.close();
		}
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

	describe('自動ロールバックされた接続での COMMIT', () => {
		/**
		 * `INSERT` でトランザクションを失い（`inTransaction` が `false` になり）、例外を投げる
		 * 偽の接続。SQLite が自動ロールバックした接続を模す。それ以外の文は `prepared: <SQL>`
		 * で失敗する。
		 * @param options - 偽の接続の振る舞い
		 * @param options.error - トランザクションを失わせる例外（既定は `SQLITE_FULL`）
		 * @param options.succeedingCommits - 最初の何回の `COMMIT` を成功させるか
		 */
		function createRolledBackConnection(
			options: { error?: Error; succeedingCommits?: number } = {},
		) {
			const original =
				options.error ??
				Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
			let succeedingCommits = options.succeedingCommits ?? 0;
			const connection = {
				inTransaction: true,
				prepare(sql: string) {
					if (sql.startsWith('INSERT')) {
						connection.inTransaction = false;
						throw original;
					}
					if (sql.startsWith('COMMIT') && succeedingCommits-- > 0) {
						return { reader: false, run: () => ({ changes: 0, lastInsertRowid: 0 }) };
					}
					throw new Error(`prepared: ${sql}`);
				},
			};
			return { connection, original };
		}

		it.each([
			'COMMIT;',
			'END',
			'end transaction',
			'RELEASE SAVEPOINT trx2;',
			'RELEASE trx2',
		])(
			'トランザクション用クライアントで失敗したあとの %s は、元の例外を cause に付けて差し替える',
			async (sql) => {
				const { connection, original } = createRolledBackConnection();
				await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(
					original,
				);

				const error = await runQuery(connection, { sql }).catch(
					(error_: unknown) => error_,
				);

				expect(error).toMatchObject({ code: 'SQLITE_FULL' });
				expect((error as Error).cause).toBe(original);
			},
		);

		it('最も外側の COMMIT を差し替えたあとは記録を残さず、次の COMMIT は元のまま失敗する', async () => {
			const { connection, original } = createRolledBackConnection();
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);
			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toMatchObject({
				cause: original,
			});

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toThrow(
				'prepared: COMMIT;',
			);
		});

		it('最も外側の ROLLBACK を省いたあとは記録を残さない', async () => {
			const { connection, original } = createRolledBackConnection();
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);
			await runQuery(connection, { sql: 'ROLLBACK' });

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toThrow(
				'prepared: COMMIT;',
			);
		});

		it.each(['ROLLBACK TO SAVEPOINT trx2', 'ROLLBACK TO trx2'])(
			'入れ子の %s を省いても記録は残り、外側の COMMIT で使われる',
			async (sql) => {
				const { connection, original } = createRolledBackConnection();
				await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(
					original,
				);
				await runQuery(connection, { sql });

				await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toMatchObject({
					cause: original,
				});
			},
		);

		it('入れ子の RELEASE SAVEPOINT を差し替えても記録は残り、外側の COMMIT でも使われる', async () => {
			const { connection, original } = createRolledBackConnection();
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);
			await expect(
				runQuery(connection, { sql: 'RELEASE SAVEPOINT trx2;' }),
			).rejects.toMatchObject({ cause: original });

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toMatchObject({
				cause: original,
			});
		});

		it('生きているトランザクションの中で COMMIT が別の理由で失敗したときは、記録があっても元の例外のまま届く', async () => {
			const { connection, original } = createRolledBackConnection();
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);
			// 入れ子のトランザクションが SAVEPOINT で新しいトランザクションを始めた状態
			connection.inTransaction = true;

			await expect(
				runQuery(connection, { sql: 'RELEASE SAVEPOINT trx2;' }),
			).rejects.toThrow('prepared: RELEASE SAVEPOINT trx2;');
		});

		it('自動ロールバックが重なったときは、外側の書き込みを捨てた最初の原因を残す', async () => {
			const first = Object.assign(new Error('database or disk is full'), {
				code: 'SQLITE_FULL',
			});
			const second = Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' });
			const errors = [first, second];
			const connection = {
				inTransaction: true,
				prepare(sql: string) {
					if (sql.startsWith('INSERT')) {
						connection.inTransaction = false;
						throw errors.shift();
					}
					throw new Error(`prepared: ${sql}`);
				},
			};
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(first);
			// 入れ子のトランザクションが SAVEPOINT で新しいトランザクションを始め、そこでも失った
			connection.inTransaction = true;
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(second);

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toMatchObject({
				code: 'SQLITE_FULL',
				cause: first,
			});
		});

		it('原因の例外が code を持たないときは、code を付けずに cause だけ付ける', async () => {
			const { connection, original } = createRolledBackConnection({
				error: new Error('unknown failure'),
			});
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);

			const error = (await runQuery(connection, { sql: 'COMMIT;' }).catch(
				(error_: unknown) => error_,
			)) as Error;

			expect(error.cause).toBe(original);
			expect(error).not.toHaveProperty('code');
			expect(error.message).toContain('after an earlier error.');
		});

		it('inTransaction を持たない接続の失敗は記録しない', async () => {
			const original = new Error('boom');
			const connection = {
				prepare() {
					throw original;
				},
			};
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toBe(original);
		});

		it('最も外側の COMMIT が自分で失敗してトランザクションを失っても、次の COMMIT は元のまま失敗する', async () => {
			const original = Object.assign(new Error('database or disk is full'), {
				code: 'SQLITE_FULL',
			});
			const connection = {
				inTransaction: true,
				prepare() {
					connection.inTransaction = false;
					throw original;
				},
			};
			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toBe(original);

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toBe(original);
		});

		it('成功した最も外側の COMMIT のあとは記録を残さない', async () => {
			const { connection, original } = createRolledBackConnection({
				succeedingCommits: 1,
			});
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);
			// 入れ子のトランザクションが SAVEPOINT で新しいトランザクションを始めた状態
			connection.inTransaction = true;
			await runQuery(connection, { sql: 'COMMIT;' });

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toThrow(
				'prepared: COMMIT;',
			);
		});

		it('BEGIN で新しいトランザクションを始めたら、前の記録を捨てる', async () => {
			const { connection, original } = createRolledBackConnection();
			await expect(runQuery(connection, { sql: 'INSERT INTO t' })).rejects.toBe(original);
			connection.inTransaction = true;
			await expect(runQuery(connection, { sql: 'BEGIN;' })).rejects.toThrow(
				'prepared: BEGIN;',
			);

			await expect(runQuery(connection, { sql: 'COMMIT;' })).rejects.toThrow(
				'prepared: COMMIT;',
			);
		});

		it('トランザクション用でないクライアントの失敗は記録せず、COMMIT は元のまま失敗する', async () => {
			const { connection, original } = createRolledBackConnection();
			await expect(runQuery(connection, { sql: 'INSERT INTO t' }, false)).rejects.toBe(
				original,
			);

			await expect(runQuery(connection, { sql: 'COMMIT;' }, false)).rejects.toThrow(
				'prepared: COMMIT;',
			);
		});
	});

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
			/**
			 * 渡された SQL を記録してから、元の `prepare` に委譲する。
			 * @param sql - 準備される SQL 文
			 */
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

		describe('自動ロールバックのあとの確定', () => {
			/**
			 * 確定に失敗した `db.transaction()` の例外を取り出す。
			 * @param run - `db.transaction()` が返す Promise
			 */
			async function rejection(
				run: PromiseLike<unknown>,
			): Promise<Error & { code?: string }> {
				const error = await Promise.resolve(run).then(
					() => {},
					(error_: unknown) => error_,
				);
				expect(error).toBeInstanceOf(Error);
				return error as Error & { code?: string };
			}

			/**
			 * COMMIT / RELEASE SAVEPOINT が `SQLITE_CONSTRAINT` で失敗する仕掛けを作る。
			 * `child` に親のない行を入れると、確定の時点で遅延外部キーが違反する。トランザクションが
			 * 生きたまま、自動ロールバックとは別の理由で失敗する例になる。
			 * @param target - 対象の DB
			 */
			async function createDeferredForeignKey(target: Knex): Promise<void> {
				await target.raw('PRAGMA foreign_keys = ON');
				await target.raw('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
				await target.raw(
					'CREATE TABLE child (id INTEGER PRIMARY KEY, p INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)',
				);
			}

			it('コールバックの中で捕捉して続けると、COMMIT の失敗に元の例外が cause で付く', async () => {
				const target = await openDb();
				await limitStorage(target);
				let caught: unknown;

				const error = await rejection(
					target.transaction(async (trx) => {
						try {
							await insertUntilFull(trx);
						} catch (error_) {
							caught = error_;
						}
					}),
				);

				expect(caught).toMatchObject({ code: 'SQLITE_FULL' });
				expect(error.cause).toBe(caught);
				expect(error.code).toBe('SQLITE_FULL');
				expect(error.message).toContain('rolled the transaction back');
				// knex が元の例外に付け足す SQL 全文（バインド値を含む）は、差し替えた例外に写さない
				expect(error.message).not.toContain('xxxx');
				expect(await target('t').count({ count: '*' })).toEqual([{ count: 0 }]);
			});

			it('ネストした内側のコールバックで捕捉して続けると、RELEASE SAVEPOINT の失敗に元の例外が cause で付く', async () => {
				const target = await openDb();
				await limitStorage(target);
				let caught: unknown;

				const error = await rejection(
					target.transaction(async (outer) => {
						await outer.raw("INSERT INTO t (v) VALUES ('outer')");
						await outer.transaction(async (inner) => {
							try {
								await insertUntilFull(inner);
							} catch (error_) {
								caught = error_;
							}
						});
					}),
				);

				expect(caught).toMatchObject({ code: 'SQLITE_FULL' });
				expect(error.cause).toBe(caught);
				expect(error.code).toBe('SQLITE_FULL');
				expect(await target('t').count({ count: '*' })).toEqual([{ count: 0 }]);
			});

			it('内側の reject を外側が捕捉して続けると、外側の COMMIT の失敗に元の例外が cause で付く', async () => {
				const target = await openDb();
				await limitStorage(target);
				let caught: unknown;

				const error = await rejection(
					target.transaction(async (outer) => {
						await outer.raw("INSERT INTO t (v) VALUES ('outer')");
						try {
							await outer.transaction(insertUntilFull);
						} catch (error_) {
							caught = error_;
						}
					}),
				);

				expect(caught).toMatchObject({ code: 'SQLITE_FULL' });
				expect(error.cause).toBe(caught);
				expect(error.code).toBe('SQLITE_FULL');
				expect(await target('t').count({ count: '*' })).toEqual([{ count: 0 }]);
			});

			it('自動ロールバックのあとに内側のトランザクションが SAVEPOINT で新しく始まっても、外側の COMMIT の失敗に元の例外が cause で付く', async () => {
				const target = await openDb();
				await limitStorage(target);
				let caught: unknown;

				const error = await rejection(
					target.transaction(async (outer) => {
						try {
							await insertUntilFull(outer);
						} catch (error_) {
							caught = error_;
						}
						await outer.transaction(async (inner) => {
							await inner.raw("INSERT INTO t (v) VALUES ('inner')");
						});
					}),
				);

				expect(caught).toMatchObject({ code: 'SQLITE_FULL' });
				expect(error.cause).toBe(caught);
				expect(error.code).toBe('SQLITE_FULL');
			});

			it('入れ子の RELEASE SAVEPOINT の差し替えのあとも、外側の COMMIT の失敗に元の例外が cause で付く', async () => {
				const target = await openDb();
				await limitStorage(target);
				const { executed } = await trackExecuted(target);
				let caught: unknown;
				let innerError: unknown;

				const error = await rejection(
					target.transaction(async (outer) => {
						try {
							await outer.transaction(async (inner) => {
								try {
									await insertUntilFull(inner);
								} catch (error_) {
									caught = error_;
								}
							});
						} catch (error_) {
							innerError = error_;
						}
					}),
				);

				expect(caught).toMatchObject({ code: 'SQLITE_FULL' });
				expect(executed.some((sql) => /^RELEASE\b/i.test(sql))).toBe(true);
				expect((innerError as Error).cause).toBe(caught);
				expect(error.cause).toBe(caught);
			});

			it('自動ロールバックのあとに、生きているトランザクションが別の理由で確定に失敗したら、その例外が届く', async () => {
				const target = await openDb();
				await createDeferredForeignKey(target);
				await limitStorage(target);

				const error = await rejection(
					target.transaction(async (outer) => {
						try {
							await insertUntilFull(outer);
						} catch {
							// 自動ロールバックされたあとも続ける
						}
						await outer.transaction(async (inner) => {
							await inner.raw('INSERT INTO child (p) VALUES (999)');
						});
					}),
				);

				expect(error.code).toContain('SQLITE_CONSTRAINT');
				expect(error.cause).toBeUndefined();
			});

			it('自動ロールバックの原因は、同じ接続の次のトランザクションの、別の理由による COMMIT の失敗に付かない', async () => {
				const target = await openDb();
				await createDeferredForeignKey(target);
				await limitStorage(target);
				await rejection(
					target.transaction(async (trx) => {
						try {
							await insertUntilFull(trx);
						} catch {
							// 続けて COMMIT に進む
						}
					}),
				);

				const error = await rejection(
					target.transaction(async (trx) => {
						await trx.raw('INSERT INTO child (p) VALUES (999)');
					}),
				);

				expect(error.code).toContain('SQLITE_CONSTRAINT');
				expect(error.cause).toBeUndefined();
			});

			it('自動ロールバックの記録は、同じ接続の次のトランザクションに残らない', async () => {
				const target = await openDb();
				await limitStorage(target);
				await rejection(
					target.transaction(async (trx) => {
						try {
							await insertUntilFull(trx);
						} catch {
							// 続けて COMMIT に進む
						}
					}),
				);

				await target.transaction(async (trx) => {
					await trx.raw("INSERT INTO t (v) VALUES ('next')");
				});

				expect(await target('t').count({ count: '*' })).toEqual([{ count: 1 }]);
			});

			it('自動ロールバックのあとに成功した文はトランザクションの外で実行され、書き込まれる（現状の制約）', async () => {
				const target = await openDb();
				await limitStorage(target);

				const error = await rejection(
					target.transaction(async (trx) => {
						try {
							await insertUntilFull(trx);
						} catch {
							// 自動ロールバックされたあとも続ける
						}
						await trx.raw("INSERT INTO t (v) VALUES ('after')");
					}),
				);

				expect(error.message).toContain('rolled the transaction back');
				expect(await target('t').count({ count: '*' })).toEqual([{ count: 1 }]);
			});
		});
	});
});
