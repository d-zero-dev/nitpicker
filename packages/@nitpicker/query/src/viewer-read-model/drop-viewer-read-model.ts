import type { ArchiveAccessor } from '@nitpicker/crawler';

import { dropViewerReadModelTables } from './drop-viewer-read-model-tables.js';

/**
 * Drops every viewer-read-model table if present (the full list lives in
 * `dropViewerReadModelTables`). Idempotent — calling this on an archive
 * with no read model is a no-op, not an error. Only ever touches the
 * `viewer_*` tables; the write-model tables (`pages`, `anchors`, etc.) are
 * never referenced.
 * @param accessor - The archive accessor to drop from. Must be writable
 *   (`accessor.readOnly === false`).
 * @throws {Error} When `accessor.readOnly` is `true`.
 * @example
 * // Force a clean rebuild instead of relying on ensureViewerReadModel's
 * // version check:
 * await dropViewerReadModel(archive);
 * await buildViewerReadModel(archive);
 */
export async function dropViewerReadModel(accessor: ArchiveAccessor): Promise<void> {
	if (accessor.readOnly) {
		throw new Error(
			'dropViewerReadModel: cannot drop the viewer read model on a read-only ' +
				'ArchiveAccessor (stub-mode, or an accessor opened via Archive.connect / ' +
				'Archive.openCached).',
		);
	}

	const knex = accessor.getKnex();
	await knex.transaction((trx) => dropViewerReadModelTables(trx));
}
