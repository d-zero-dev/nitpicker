import type { Knex } from 'knex';

import { IncompatibleArchiveError } from './meta/types.js';

/**
 * Rejects archives that have `pages` rows but no matching `content_items`
 * rows — the Phase 6-C entity tables have been created (by
 * `migratePhase6CEntityTables`) but never populated by
 * `scripts/migrate-to-phase6.mjs`. Phase 6-F readers rely on the new tables
 * exclusively, so opening such an archive would surface as an empty viewer
 * / MCP / CLI response instead of a clear error.
 *
 * Fresh archives (no `pages` rows yet) pass through — a writer will
 * populate both `pages` and `content_items` during crawl.
 *
 * Legacy read-only stubs (no `pages` table yet, e.g. pre-schema-init
 * `._nitpicker-*` tmpDirs) also pass through — `assertCompatibleVersion`
 * handles those cases separately upstream.
 * @param instance - The libsql / better-sqlite3-shaped Knex instance.
 * @throws {IncompatibleArchiveError} When `pages` has rows and
 *   `content_items` is empty.
 */
export async function assertPhase6Populated(instance: Knex): Promise<void> {
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		return;
	}
	const [{ count: pagesCount }] = (await instance('pages').count({ count: '*' })) as {
		count: number | string;
	}[];
	if (Number(pagesCount ?? 0) === 0) {
		return;
	}
	const hasContentItems = await instance.schema.hasTable('content_items');
	if (!hasContentItems) {
		throw new IncompatibleArchiveError(
			'This archive predates Phase 6 and has not been migrated. Run ' +
				'`node scripts/migrate-to-phase6.mjs <archive>` on the .nitpicker file ' +
				'before opening it with this CLI.',
		);
	}
	const [{ count: contentItemsCount }] = (await instance('content_items').count({
		count: '*',
	})) as { count: number | string }[];
	if (Number(contentItemsCount ?? 0) > 0) {
		return;
	}
	throw new IncompatibleArchiveError(
		'This archive predates Phase 6 and has not been migrated. Run ' +
			'`node scripts/migrate-to-phase6.mjs <archive>` on the .nitpicker file ' +
			'before opening it with this CLI.',
	);
}
