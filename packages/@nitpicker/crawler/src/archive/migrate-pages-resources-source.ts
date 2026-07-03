import type { Knex } from 'knex';

/**
 * Add `pages.source` and `resources.source` columns (provenance taxonomy:
 * `crawled` / `inventory-seed` / `inventory-discovered`) and their indexes
 * to archives that pre-date the `crawl --inventory` feature.
 *
 * Idempotent: a no-op when both columns already exist. SQLite's
 * `ALTER TABLE ADD COLUMN` with a NOT NULL DEFAULT applies the default to
 * every existing row at column-add time, so no explicit `UPDATE` is needed
 * to backfill — pre-existing rows become `'crawled'` automatically.
 *
 * Runs only on writer-side `Database.connect`; read-only viewer
 * attaches skip this so the user's tmpDir is never rewritten.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migratePagesResourcesSource(instance: Knex): Promise<void> {
	const hasPages = await instance.schema.hasTable('pages');
	const hasResources = await instance.schema.hasTable('resources');
	if (!hasPages && !hasResources) {
		return;
	}
	const hasPagesSource = hasPages && (await instance.schema.hasColumn('pages', 'source'));
	const hasResourcesSource =
		hasResources && (await instance.schema.hasColumn('resources', 'source'));
	if (hasPagesSource && hasResourcesSource) {
		return;
	}

	const changes: string[] = [];
	if (hasPages && !hasPagesSource) {
		await instance.schema.table('pages', (t) => {
			t.string('source').notNullable().defaultTo('crawled');
			t.index('source');
		});
		changes.push('pages.source added');
	}
	if (hasResources && !hasResourcesSource) {
		await instance.schema.table('resources', (t) => {
			t.string('source').notNullable().defaultTo('crawled');
			t.index('source');
		});
		changes.push('resources.source added');
	}
	if (changes.length === 0) {
		return;
	}
	// eslint-disable-next-line no-console
	console.error(`[migrate] ${changes.join(', ')}`);
}
