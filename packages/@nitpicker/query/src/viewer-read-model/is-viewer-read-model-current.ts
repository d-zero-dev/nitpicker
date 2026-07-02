import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getViewerReadModelVersion } from './get-viewer-read-model-version.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

/**
 * Checks whether the viewer read model exists AND is at the current schema
 * version. A pure read — safe to call on read-only accessors (stub mode,
 * `Archive.connect`, `Archive.openCached`), never mutates anything.
 *
 * Intended for fast-path callers (the `/api/pages` viewer route) that must
 * decide, without ever attempting a build, whether `viewer_pages` and its
 * sibling tables are safe to read from. Building a missing/stale read model
 * is a separate, writable-accessor-only concern (`ensureViewerReadModel`) —
 * this function never triggers one, so it is always safe on the read-only
 * accessors normal viewer opens use.
 * @param accessor - The archive accessor to check.
 * @returns `true` iff the read model exists and its persisted
 *   `schema_version` equals {@link VIEWER_READ_MODEL_SCHEMA_VERSION}.
 * @example
 * if (await isViewerReadModelCurrent(accessor)) {
 *   return listViewerPages(accessor, options);
 * }
 * return listPages(accessor, options); // legacy fallback
 */
export async function isViewerReadModelCurrent(
	accessor: ArchiveAccessor,
): Promise<boolean> {
	const version = await getViewerReadModelVersion(accessor);
	return version === VIEWER_READ_MODEL_SCHEMA_VERSION;
}
