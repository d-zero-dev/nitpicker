import type { Knex } from 'knex';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import Archive from './archive.js';
import { withBulkWritePragmas } from './with-bulk-write-pragmas.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Reads one connection PRAGMA back as a number, the way SQLite reports it.
 * @param knex - The connection to read from.
 * @param name - The PRAGMA name.
 * @returns The current value.
 */
async function readPragma(knex: Knex, name: string): Promise<number> {
	const [row] = await knex.raw<Record<string, number>[]>(`PRAGMA ${name}`);
	return Number(row![name]);
}

/**
 * A stand-in for the archive connection whose `raw` answers PRAGMA reads with
 * `0`, records every statement, and fails the statements `fail` picks. Only
 * `raw` and `isTransaction` are used by the function under test.
 * @param fail - Returns the error for a statement that should fail, or
 *   `undefined` to let it succeed.
 * @returns The connection and the statements it was given, in order.
 */
function createRecordingKnex(fail: (sql: string) => Error | undefined) {
	const statements: string[] = [];
	const knex = {
		isTransaction: undefined,
		raw: (sql: string) => {
			statements.push(sql);
			const error = fail(sql);
			if (error) {
				return Promise.reject(error);
			}
			const read = /^PRAGMA (\w+)$/.exec(sql);
			return Promise.resolve(read ? [{ [read[1]!]: 0 }] : []);
		},
	} as unknown as Knex;
	return { knex, statements };
}

describe('withBulkWritePragmas', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_with_bulk_write_pragmas__');
	let archive: InstanceType<typeof Archive>;
	let knex: Knex;

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'a.nitpicker'),
			cwd: workingDir,
		});
		knex = archive.getKnex();
	});

	afterAll(async () => {
		await archive.releaseHandle();
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('starts from the read-tuned connection defaults', async () => {
		expect(await readPragma(knex, 'mmap_size')).toBe(268_435_456);
		expect(await readPragma(knex, 'cache_size')).toBe(-65_536);
	});

	it('applies the bulk-write settings while the callback runs, leaves temp_store alone, and returns its result', async () => {
		const seen = await withBulkWritePragmas(knex, async () => ({
			tempStore: await readPragma(knex, 'temp_store'),
			mmapSize: await readPragma(knex, 'mmap_size'),
			cacheSize: await readPragma(knex, 'cache_size'),
		}));
		expect(seen).toEqual({ tempStore: 0, mmapSize: 0, cacheSize: -16_384 });
	});

	it('puts the read-tuned values back after the callback', async () => {
		await withBulkWritePragmas(knex, () => Promise.resolve());
		expect(await readPragma(knex, 'mmap_size')).toBe(268_435_456);
		expect(await readPragma(knex, 'cache_size')).toBe(-65_536);
	});

	it('puts back the values found on entry, not the defaults', async () => {
		await knex.raw('PRAGMA cache_size = -1024');
		try {
			await withBulkWritePragmas(knex, () => Promise.resolve());
			expect(await readPragma(knex, 'cache_size')).toBe(-1024);
		} finally {
			await knex.raw('PRAGMA cache_size = -65536');
		}
	});

	it('leaves the settings it does not change as the caller set them', async () => {
		await knex.raw('PRAGMA wal_autocheckpoint = 0');
		await knex.raw('PRAGMA foreign_keys = OFF');
		try {
			await withBulkWritePragmas(knex, () => Promise.resolve());
			expect(await readPragma(knex, 'wal_autocheckpoint')).toBe(0);
			expect(await readPragma(knex, 'foreign_keys')).toBe(0);
		} finally {
			await knex.raw('PRAGMA wal_autocheckpoint = 1000');
			await knex.raw('PRAGMA foreign_keys = ON');
		}
	});

	it('rejects a transaction object, since mmap_size cannot change inside one', async () => {
		await knex.transaction(async (trx) => {
			await expect(withBulkWritePragmas(trx, () => Promise.resolve())).rejects.toThrow(
				'must be called outside a transaction',
			);
		});
		expect(await readPragma(knex, 'mmap_size')).toBe(268_435_456);
	});

	it('puts the values back when the callback throws, and rethrows', async () => {
		await expect(
			withBulkWritePragmas(knex, () => Promise.reject(new Error('build failed'))),
		).rejects.toThrow('build failed');
		expect(await readPragma(knex, 'mmap_size')).toBe(268_435_456);
		expect(await readPragma(knex, 'cache_size')).toBe(-65_536);
	});

	it('reports both errors when the callback throws and putting the values back throws too', async () => {
		const workError = new Error('build failed');
		const restoreError = new Error('connection gone');
		let workDone = false;
		const { knex: failingKnex } = createRecordingKnex(() =>
			workDone ? restoreError : undefined,
		);
		const outcome = await withBulkWritePragmas(failingKnex, () => {
			workDone = true;
			return Promise.reject(workError);
		}).then(
			() => null,
			(error: unknown) => error,
		);
		expect(outcome).toBeInstanceOf(AggregateError);
		expect((outcome as AggregateError).errors).toEqual([workError, restoreError]);
	});

	it('puts back every setting it reached when an entry setting fails, in reverse, and rethrows that failure', async () => {
		const entryError = new Error('cache_size refused');
		const { knex: failingKnex, statements } = createRecordingKnex((sql) =>
			sql === 'PRAGMA cache_size = -16384' ? entryError : undefined,
		);
		await expect(withBulkWritePragmas(failingKnex, () => Promise.resolve())).rejects.toBe(
			entryError,
		);
		// The stand-in reads every PRAGMA as 0, so "back" is `= 0` here.
		expect(statements).toEqual([
			'PRAGMA mmap_size',
			'PRAGMA mmap_size = 0',
			'PRAGMA cache_size',
			'PRAGMA cache_size = -16384',
			'PRAGMA cache_size = 0',
			'PRAGMA mmap_size = 0',
		]);
	});

	it('resolves with the result and warns when only putting the values back fails, since the write itself finished', async () => {
		const restoreError = new Error('connection gone');
		let workDone = false;
		const { knex: failingKnex } = createRecordingKnex(() =>
			workDone ? restoreError : undefined,
		);
		const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
		try {
			const result = await withBulkWritePragmas(failingKnex, () => {
				workDone = true;
				return Promise.resolve('written');
			});
			expect(result).toBe('written');
			expect(emitWarning).toHaveBeenCalledOnce();
			expect(String(emitWarning.mock.calls[0]![0])).toContain('connection gone');
		} finally {
			emitWarning.mockRestore();
		}
	});
});
