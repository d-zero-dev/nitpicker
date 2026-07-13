import type { Knex } from 'knex';

import { populateBlobRefs } from './populate-blob-refs.js';
import { populateContentTypeRefs } from './populate-content-type-refs.js';
import { populateHeaderTables } from './populate-header-tables.js';
import { populateJsonRefs } from './populate-json-refs.js';
import { populateTextRefs } from './populate-text-refs.js';
import { populateUrlRefs } from './populate-url-refs.js';

/**
 * Runs the six Phase 6-B sub-steps (issue #191) in the plan-specified
 * order against an already-connected archive:
 *
 * 1. `content_type_refs` — 6-B-0 (must precede 6-D-1 / 6-D-3 JOINs).
 * 2. `url_refs` — 6-B-1.
 * 3. `text_refs` — 6-B-2.
 * 4. `json_refs` — 6-B-3.
 * 5. `blob_refs` — 6-B-4.
 * 6. Header tables — 6-B-5 (name / value / set / entries / flags).
 *
 * The order is not arbitrary: `content_type_refs` before Phase 6-D
 * JOINs, and `url_refs` before Phase 6-D's `url_refs.id` lookups. Within
 * Phase 6-B the ordering is: dictionary tables (0..4) first, header
 * tables (5) last — the header tables' entries reference name / value
 * refs but those live inside step 5, so no cross-step barrier is
 * required.
 *
 * Every sub-step is independently idempotent via `INSERT OR IGNORE` on
 * its natural key. Running this orchestrator twice on the same archive
 * produces the same rows — no phase marker table is used. On the plan's
 * spec, the whole invocation is expected to run inside one writer
 * transaction with `.bak` protection at the caller level; this function
 * does not open its own transaction so the caller controls the boundary.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * // Typical migration-script use: connect via Archive, wrap in a
 * // transaction, run every sub-step, then rely on the caller's `.bak`
 * // safety net if any step throws.
 * const archive = await Archive.open(archivePath);
 * const knex = archive.getKnex();
 * await knex.transaction(async (trx) => {
 *   await populatePhase6BRefs(trx);
 * });
 * await archive.write();
 */
export async function populatePhase6BRefs(trx: Knex): Promise<void> {
	await populateContentTypeRefs(trx);
	await populateUrlRefs(trx);
	await populateTextRefs(trx);
	await populateJsonRefs(trx);
	await populateBlobRefs(trx);
	await populateHeaderTables(trx);
}
