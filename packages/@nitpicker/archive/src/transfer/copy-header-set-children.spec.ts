import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyDictionariesForConcat } from './copy-dictionaries-for-concat.js';
import { copyHeaderSetChildren } from './copy-header-set-children.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-header-children-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-header-children-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyHeaderSetChildren', () => {
	it('copies entries and flags, remapped to the destination header_sets id', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const [name] = await source('header_name_refs')
			.insert({ name: 'content-security-policy' })
			.returning('id');
		const [value] = await source('header_value_refs')
			.insert({ hash: Buffer.from('01', 'hex'), value: "default-src 'self'" })
			.returning('id');
		const [set] = await source('header_sets')
			.insert({
				raw_json_hash: Buffer.from('a1', 'hex'),
				raw_hash: Buffer.from('a2', 'hex'),
				stable_hash: Buffer.from('a3', 'hex'),
				entry_count: 1,
				stable_entry_count: 1,
			})
			.returning('id');
		await source('header_set_entries').insert({
			header_set_id: set.id,
			name_id: name.id,
			occurrence: 1,
			value_id: value.id,
			is_volatile: 0,
		});
		await source('header_flags').insert({
			header_set_id: set.id,
			has_csp: 1,
			has_x_frame_options: 0,
			has_x_content_type_options: 0,
			has_hsts: 0,
			has_referrer_policy: 0,
			has_permissions_policy: 0,
			has_set_cookie: 0,
			cache_policy: null,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await copyDictionariesForConcat(dest);
			await copyHeaderSetChildren(dest);

			const [destSet] = await dest('header_sets').select('id');
			const entries = await dest('header_set_entries').where('header_set_id', destSet.id);
			expect(entries).toHaveLength(1);
			const flags = await dest('header_flags').where('header_set_id', destSet.id).first();
			expect(flags.has_csp).toBe(1);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
