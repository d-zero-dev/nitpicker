import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getViewerReadModelVersion } from './get-viewer-read-model-version.js';

/**
 * Checks whether the viewer read model has been built at all, regardless of
 * schema version. A pure read — safe to call on read-only accessors (stub
 * mode, `Archive.connect`, `Archive.openCached`), never mutates anything.
 *
 * Composes on {@link getViewerReadModelVersion} rather than re-probing
 * `viewer_read_model_meta` independently, so the "does the singleton row
 * exist" check only has one implementation to keep in sync.
 * @param accessor - The archive accessor to check.
 * @returns `true` iff `viewer_read_model_meta` exists as a table and holds
 *   its singleton row (`id = 1`).
 * @example
 * if (!(await hasViewerReadModel(accessor))) {
 *   // fall back to the live query path, or prompt a build.
 * }
 */
export async function hasViewerReadModel(accessor: ArchiveAccessor): Promise<boolean> {
	return (await getViewerReadModelVersion(accessor)) !== null;
}
