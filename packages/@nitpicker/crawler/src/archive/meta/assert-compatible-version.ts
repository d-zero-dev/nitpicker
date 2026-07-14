import type { Knex } from 'knex';

import { compareSemver } from './compare-semver.js';
import { IncompatibleArchiveError } from './types.js';

/**
 * Minimum `info.version` this build accepts. Archives older than this must
 * be upgraded by running the matching migration script before they can be
 * opened (see {@link IncompatibleArchiveError}'s message for the mapping
 * from archive version to script).
 *
 * History:
 *
 * - **pre-0.10**: HTML snapshots in `snapshot-html.zip` (#75), then
 *   relocated to `page_html_blobs` (#84); pages table has flat `noindex`,
 *   `og:type`-style columns derived from beholder 2.x's flat `Meta`.
 * - **0.10.0**: `page_html_blobs` BLOB storage (#75/#84) +
 *   nested-`Meta`-derived flat columns, `meta_extras` JSON, `page_tags` /
 *   `page_jsonld` tables, denormalised aggregates (#85).
 * - **0.13.0**: this build. Phase 6 write-model refactor (#103) —
 *   `content_items` / `page_meta` / `resource_items` / `anchor_edges` /
 *   `resource_ref_edges` / `image_items` entity tables plus `url_refs` /
 *   `text_refs` / `content_type_refs` / `json_refs` / `blob_refs` /
 *   `header_flags` ref tables. Readers query the new tables exclusively;
 *   pre-6 archives must be upgraded with `scripts/migrate-to-phase6.mjs`
 *   which bumps `info.version` to `0.13.0` on completion.
 */
export const REQUIRED_FORMAT_VERSION = '0.13.0';

/**
 * Verifies that the archive's on-disk format is compatible with this build.
 *
 * Compares the archive's `info.version` (a semver string written by
 * `setConfig` at archive-create time, or by the migration script) against
 * {@link REQUIRED_FORMAT_VERSION}. Older archives throw
 * {@link IncompatibleArchiveError} pointing the operator at the migration
 * script.
 *
 * Called from `Database.#init` for both writer and read-only (stub viewer)
 * connections so old `._nitpicker-*` stubs surface the error too. New
 * archives where the `info` table does not yet exist are tolerated —
 * `initSchema` will fill them in next.
 *
 * The check is intentionally version-string-only, not schema-shape-based:
 * `info.version` is the single declared source of truth, and a v0.10
 * `migrate-to-0.10.mjs` run bumps it explicitly so the assertion passes
 * once migration completes.
 * @param instance - The Knex query builder for the archive's libsql connection.
 * @throws {IncompatibleArchiveError} when `info.version` is older than
 *   {@link REQUIRED_FORMAT_VERSION}, or missing entirely on a non-empty
 *   archive.
 */
export async function assertCompatibleVersion(instance: Knex): Promise<void> {
	const hasInfo = await instance.schema.hasTable('info');
	if (!hasInfo) {
		// Brand-new archive — `initSchema` will create `info` and fill in
		// the version next.
		return;
	}
	const hasVersionColumn = await instance.schema.hasColumn('info', 'version');
	if (!hasVersionColumn) {
		// Pre-version-tracked archive (very old). The column did not exist
		// before the version was added to the info schema; reject with
		// `'unknown'` so the operator runs the migration script.
		throw new IncompatibleArchiveError('unknown', REQUIRED_FORMAT_VERSION);
	}
	const row = await instance
		.from<{ version: string | null }>('info')
		.select('version')
		.first();
	if (row === undefined) {
		// `Archive.create()` calls `Database.connect` (which runs
		// `initSchema` to create the info table) BEFORE `setConfig` writes
		// the initial row. The transient empty-info state is a normal step
		// of archive creation, not a corrupted pre-0.10 archive.
		return;
	}
	const archiveVersion = row.version ?? null;
	if (archiveVersion === null || archiveVersion === '') {
		throw new IncompatibleArchiveError('unknown', REQUIRED_FORMAT_VERSION);
	}
	if (compareSemver(archiveVersion, REQUIRED_FORMAT_VERSION) < 0) {
		throw new IncompatibleArchiveError(archiveVersion, REQUIRED_FORMAT_VERSION);
	}
}
