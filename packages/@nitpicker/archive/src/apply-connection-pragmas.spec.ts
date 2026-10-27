import type { Knex } from 'knex';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyConnectionPragmas } from './apply-connection-pragmas.js';
import Archive from './archive.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Reads one connection PRAGMA back as a number.
 * @param knex - The connection to read from.
 * @param name - The PRAGMA name.
 * @returns The current value.
 */
async function readPragma(knex: Knex, name: string): Promise<number> {
	const [row] = (await knex.raw(`PRAGMA ${name}`)) as Record<string, number>[];
	return Number(row![name]);
}

describe('applyConnectionPragmas', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_connection_pragmas__',
	);
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

	it('puts the read-tuned values back on a connection whose settings were changed', async () => {
		await knex.raw('PRAGMA foreign_keys = OFF');
		await knex.raw('PRAGMA wal_autocheckpoint = 0');
		await knex.raw('PRAGMA cache_size = -1024');
		await knex.raw('PRAGMA mmap_size = 0');

		await applyConnectionPragmas(knex);

		expect({
			foreignKeys: await readPragma(knex, 'foreign_keys'),
			walAutocheckpoint: await readPragma(knex, 'wal_autocheckpoint'),
			cacheSize: await readPragma(knex, 'cache_size'),
			mmapSize: await readPragma(knex, 'mmap_size'),
		}).toEqual({
			foreignKeys: 1,
			walAutocheckpoint: 1000,
			cacheSize: -65_536,
			mmapSize: 268_435_456,
		});
	});
});
