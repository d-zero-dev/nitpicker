import type { ArchiveAccessor } from '@nitpicker/crawler';

import { buildViewerReadModel } from './build-viewer-read-model.js';
import { getViewerReadModelVersion } from './get-viewer-read-model-version.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

/**
 * Builds the viewer read model if it is missing or stale (schema version
 * mismatch), otherwise does nothing. The idempotent entry point intended
 * for a future crawl-completion build trigger and any other on-demand
 * caller that just wants "make sure this is current."
 *
 * When the read model is already current, this function returns without
 * ever inspecting `accessor.readOnly` — a read-only caller polling an
 * already-built, up-to-date archive never throws.
 * @param accessor - The archive accessor. Must be writable
 *   (`accessor.readOnly === false`) whenever a build actually turns out to
 *   be necessary — see {@link buildViewerReadModel}'s guard, which this
 *   function inherits by delegating to it.
 * @throws {Error} When a build is needed and `accessor.readOnly` is `true`.
 * @example
 * // After a crawl completes, against the writable Archive that just wrote it:
 * await ensureViewerReadModel(archive);
 */
export async function ensureViewerReadModel(accessor: ArchiveAccessor): Promise<void> {
	const version = await getViewerReadModelVersion(accessor);
	if (version === VIEWER_READ_MODEL_SCHEMA_VERSION) {
		return;
	}
	await buildViewerReadModel(accessor);
}
