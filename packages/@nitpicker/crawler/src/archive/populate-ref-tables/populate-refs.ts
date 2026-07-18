import type { ProgressCallback } from '../create-progress-reporter.js';
import type { Knex } from 'knex';

import { populateBlobRefs } from './populate-blob-refs.js';
import { populateContentTypeRefs } from './populate-content-type-refs.js';
import { populateHeaderTables } from './populate-header-tables.js';
import { populateJsonRefs } from './populate-json-refs.js';
import { populateTextRefs } from './populate-text-refs.js';
import { populateUrlRefs } from './populate-url-refs.js';

/**
 * Runs the six 0.13 ref-table populates (issue #191) in this fixed
 * order against an already-connected archive:
 *
 * 1. `content_type_refs`
 * 2. `url_refs`
 * 3. `text_refs`
 * 4. `json_refs`
 * 5. `blob_refs`
 * 6. Header tables (name / value / set / entries / flags).
 *
 * The order is an execution-order invariant, not arbitrary: the entity
 * populates that run afterwards (`populateEntityTables`) JOIN against
 * `content_type_refs` when filling `content_items` / `resource_items`,
 * and look up `url_refs.id` for every URL column, so both dictionaries
 * must be complete first. Within this function the ordering is:
 * dictionary tables (1–5) first, header tables (6) last — the header
 * tables' entries reference name / value refs, but those are inserted
 * by `populateHeaderTables` itself, so no barrier between sub-populates
 * is required.
 *
 * Every sub-populate is independently idempotent via `INSERT OR IGNORE`
 * on its natural key. Running this orchestrator twice on the same archive
 * produces the same rows — no phase marker table is used. The whole
 * invocation is expected to run inside one writer
 * transaction with `.bak` protection at the caller level; this function
 * does not open its own transaction so the caller controls the boundary.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param onProgress - Optional sink threaded to every sub-populate for
 *   periodic progress lines; see {@link ../create-progress-reporter.ts}.
 * @example
 * // Typical migration-script use: connect via Archive, wrap in a
 * // transaction, run every sub-step, then rely on the caller's `.bak`
 * // safety net if any step throws.
 * const archive = await Archive.open(archivePath);
 * const knex = archive.getKnex();
 * await knex.transaction(async (trx) => {
 *   await populateRefTables(trx);
 * });
 * await archive.write();
 */
export async function populateRefTables(
	trx: Knex,
	onProgress?: ProgressCallback,
): Promise<void> {
	await populateContentTypeRefs(trx);
	await populateUrlRefs(trx, onProgress);
	await populateTextRefs(trx, onProgress);
	await populateJsonRefs(trx, onProgress);
	await populateBlobRefs(trx, onProgress);
	await populateHeaderTables(trx, onProgress);
}
