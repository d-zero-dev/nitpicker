import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from './build-full-schema-test-db.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '../__mock__');
const filename = path.resolve(workingDir, 'build-full-schema-test-db-test.sqlite');

afterEach(async () => {
	await fs.rm(filename, { force: true });
});

describe('buildFullSchemaTestDb', () => {
	it('creates every entity/adjunct table including migration-only columns', async () => {
		const db = await buildFullSchemaTestDb(filename);
		expect(await db.schema.hasTable('content_items')).toBe(true);
		expect(await db.schema.hasColumn('content_items', 'alias_of_id')).toBe(true);
		expect(await db.schema.hasColumn('content_items', 'dedupe_cap_event_id')).toBe(true);
		expect(await db.schema.hasColumn('page_meta', 'body_hash')).toBe(true);
		expect(await db.schema.hasTable('page_template_clusters')).toBe(true);
		await db.destroy();
	});

	it('writes a config row reachable via getConfig-shaped select', async () => {
		const db = await buildFullSchemaTestDb(filename, { roots: ['https://a.example/'] });
		const [row] = await db.select('roots').from('info');
		expect(JSON.parse(row.roots)).toEqual(['https://a.example/']);
		await db.destroy();
	});

	it('skips writing an info row when config is null', async () => {
		const db = await buildFullSchemaTestDb(filename, null);
		const rows = await db.select('*').from('info');
		expect(rows).toHaveLength(0);
		await db.destroy();
	});
});
