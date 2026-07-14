import type { ArchiveAccessor } from './archive-accessor.js';
import type { PageDomPathResolver } from './populate-entity-tables/populate-image-items.js';

import { populateEntityTables } from './populate-entity-tables/populate-entities.js';
import { populateRefTables } from './populate-ref-tables/populate-refs.js';

/**
 * Runs the 0.13 populate steps (`populateRefTables` + `populateEntityTables`)
 * in-place against an archive that has been seeded via the pre-0.13 write
 * path (`archive.setPage` / `archive.setResource` / ...). Reader specs
 * across `@nitpicker/query`, `@nitpicker/viewer`, and `@nitpicker/mcp-server`
 * need this because the crawler's write path still targets the legacy
 * `pages` / `anchors` / ... tables (#196 will move the write path to the
 * new entity tables); until then, a reader spec that skips this helper
 * would exercise readers against empty `content_items` / `anchor_edges`
 * and always see empty results.
 *
 * Used **only** in reader spec `beforeAll` blocks — the migrator script
 * (`scripts/migrate-to-0.13.mjs`) drives the same populate functions
 * under `.bak` protection at runtime, so production migrations do not go
 * through this helper.
 * @param accessor - Writable archive accessor whose legacy tables have
 *   already been seeded by the caller (`archive.setPage(...)` etc.).
 * @param options - Optional overrides. `resolvePageDomPaths` defaults to
 *   an `unknown/<image-id>` fallback resolver so specs that do not
 *   exercise `image_items.dom_path_text_id` avoid a jsdom dependency.
 *   Specs that depend on real dom-path resolution inject the
 *   jsdom-backed resolver used by the migrator instead.
 * @param options.resolvePageDomPaths - Optional DOM-path resolver.
 * @example
 * beforeAll(async () => {
 *   await archive.setConfig(...);
 *   await archive.setPage(...);
 *   await populateMigrationTables(archive);
 * });
 */
export async function populateMigrationTables(
	accessor: ArchiveAccessor,
	options: {
		resolvePageDomPaths?: PageDomPathResolver;
	} = {},
): Promise<void> {
	const knex = accessor.getKnex();
	const resolvePageDomPaths: PageDomPathResolver =
		options.resolvePageDomPaths ??
		((_pageId, _html, images) =>
			Promise.resolve(
				new Map(
					images.map((img) => [
						img.id,
						{ path: `unknown/${img.id}`, case: 'unknown' as const },
					]),
				),
			));
	await knex.raw('PRAGMA foreign_keys = ON');
	await knex.transaction(async (trx) => {
		await populateRefTables(trx);
		await populateEntityTables(trx, resolvePageDomPaths);
	});
}
