import type { Knex } from 'knex';

import { IncompatibleArchiveError } from './types.js';

/**
 * Current archive format version. Bumped whenever the on-disk schema changes
 * in a way that would corrupt or mis-read prior archives.
 *
 * History:
 *
 * - **v1** — pre-this-PR. Flat OG / Twitter / robots columns derived from
 *   beholder 2.x's flat Meta shape. No `pages.meta_extras`, no `page_tags`,
 *   no `page_jsonld`.
 * - **v2** — this PR. Nested Meta-derived flat columns, `meta_extras` JSON,
 *   `page_tags` / `page_jsonld` tables, denormalised `tag_count` /
 *   `jsonld_count` / `tags_providers_csv` on `pages`.
 */
export const ARCHIVE_FORMAT_VERSION = 2;

/**
 * Verifies that the archive's on-disk schema is compatible with this build.
 *
 * The check uses the presence of `pages.meta_extras` as the v1→v2 marker
 * (rather than an explicit `info.archiveFormatVersion` column) because the
 * v1 schema is already locked in the wild and we cannot retroactively add
 * the marker column. New archives created by v2 always have `meta_extras`,
 * so the check is symmetric.
 *
 * Called from `Database.#init` after the read-only early-return so that
 * stub viewers (read-only connections to interrupted crawl tmpDirs) also
 * surface the error. New archives where `info` does not yet exist are
 * tolerated — they will be initialised by `initSchema` in the next step.
 *
 * Plan: clean-break migration. Existing v1 archives are rejected with a
 * friendly message rather than auto-migrated; `v0.x` policy allows breaking
 * changes (see MEMORY: `v0-x-breaking-changes`).
 * @param instance - The Knex query builder for the archive's libsql connection.
 * @throws {IncompatibleArchiveError} when the archive is v1 (or any pre-v2 format).
 */
export async function assertCompatibleVersion(instance: Knex): Promise<void> {
	const hasInfo = await instance.schema.hasTable('info');
	if (!hasInfo) {
		// Brand-new archive — `initSchema` will fill in the v2 layout next.
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		// Partial archive (info exists, pages does not). Out of scope; let
		// downstream code surface the I/O-level error.
		return;
	}
	const hasMetaExtras = await instance.schema.hasColumn('pages', 'meta_extras');
	if (hasMetaExtras) return;
	const row = await instance.from<{ version?: string }>('info').select('version').first();
	const archiveVersion = row?.version ?? 'unknown';
	throw new IncompatibleArchiveError(archiveVersion, ARCHIVE_FORMAT_VERSION);
}
