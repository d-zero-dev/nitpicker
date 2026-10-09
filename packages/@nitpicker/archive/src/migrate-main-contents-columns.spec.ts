import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateMainContentsColumns } from './migrate-main-contents-columns.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates a 0.13
 * archive predating this feature: `page_meta` exists (keyed by `page_id`)
 * but has none of the `main_content_*` / `scroll_height_*` columns.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance.
 */
async function buildLegacyPageMeta(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('page_meta', (t) => {
		t.integer('page_id').primary();
		t.string('lang');
		t.integer('tag_count');
		t.integer('jsonld_count');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-test.sqlite',
		'migrate-idempotent.sqlite',
		'migrate-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateMainContentsColumns', () => {
	it('adds all main_content_* / scroll_height_* columns to an existing page_meta', async () => {
		const { instance } = await buildLegacyPageMeta('migrate-test.sqlite');
		await instance('page_meta').insert({ page_id: 1, lang: 'ja' });

		await migrateMainContentsColumns(instance);

		for (const column of [
			'main_content_node_name',
			'main_content_id',
			'main_content_role',
			'main_content_selector',
			'main_content_class_list',
			'main_content_word_count',
			'main_content_body_word_count',
			'main_content_heading_count',
			'main_content_image_count',
			'main_content_table_count',
			'main_content_button_count',
			'main_content_iframe_count',
			'main_content_video_count',
			'main_content_audio_count',
			'main_content_canvas_count',
			'scroll_height_desktop',
			'scroll_height_mobile',
		]) {
			expect(await instance.schema.hasColumn('page_meta', column), column).toBe(true);
		}

		// Pre-existing row and columns survive untouched, new columns are NULL.
		const [row] = await instance
			.select('lang', 'main_content_word_count')
			.from('page_meta');
		expect(row.lang).toBe('ja');
		expect(row.main_content_word_count).toBeNull();

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyPageMeta('migrate-idempotent.sqlite');

		await migrateMainContentsColumns(instance);
		await expect(migrateMainContentsColumns(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('page_meta', 'main_content_word_count')).toBe(
			true,
		);

		await instance.destroy();
	});

	it('returns silently when page_meta does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migrateMainContentsColumns(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
