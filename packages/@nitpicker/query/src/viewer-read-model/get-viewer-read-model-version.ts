import type { ViewerReadModelMetaRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns the persisted schema/build version of the viewer read model, or
 * `null` if no read model has been built yet. A pure read — safe to call on
 * read-only accessors, never mutates anything.
 *
 * Coerces the stored value with `Number(...)`: libsql/knex sometimes returns
 * integer columns as strings (the same known quirk `count-pages-by-tag.ts`
 * and friends work around), and a bare string would break the strict `===`
 * comparison `ensureViewerReadModel` does against
 * `VIEWER_READ_MODEL_SCHEMA_VERSION`.
 * @param accessor - The archive accessor to check.
 * @returns The `schema_version` value, or `null` when absent.
 * @example
 * const version = await getViewerReadModelVersion(accessor);
 * if (version !== VIEWER_READ_MODEL_SCHEMA_VERSION) {
 *   // stale or never built — throws a clear error instead of rebuilding.
 *   throw new Error(`viewer read model is stale (version=${version})`);
 * }
 */
export async function getViewerReadModelVersion(
	accessor: ArchiveAccessor,
): Promise<number | null> {
	const knex = accessor.getKnex();
	const exists = await knex.schema.hasTable('viewer_read_model_meta');
	if (!exists) {
		return null;
	}
	const row: Pick<ViewerReadModelMetaRow, 'schema_version'> | undefined = await knex(
		'viewer_read_model_meta',
	)
		.where('id', 1)
		.first('schema_version');
	return row?.schema_version == null ? null : Number(row.schema_version);
}
