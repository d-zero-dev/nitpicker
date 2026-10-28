import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';

import { releaseFinishedStatements } from '@nitpicker/archive/release-finished-statements';
import { groupAliasCandidates } from '@nitpicker/archive/url-alias/group-alias-candidates';

import { normalizeBodyHash } from './normalize-body-hash.js';

/**
 * Rows per staging `INSERT`. Two bound variables a row, so 250 rows stay
 * within SQLite's 500-term compound-`SELECT` cap (knex's multi-row insert on
 * SQLite) and its historical 999-variable default.
 */
const CHUNK_SIZE = 250;

/**
 * Connection-local table the assignments are staged in before the single
 * `UPDATE` that writes them, so the archive file itself never gains a
 * helper table.
 */
const STAGING_TABLE = 'viewer_alias_assignments';

/**
 * One candidate row as the query below returns it. `bodyHash` is whatever
 * the driver hands back for a `BLOB` (`ArrayBuffer` or a typed array) until
 * it is normalized to a `Uint8Array`.
 */
interface AliasCandidateRow {
	id: number;
	url: string;
	urlId: number;
	titleTextId: number;
	canonicalUrlId: number | null;
	bodyHash: ArrayBuffer | Uint8Array | null;
}

/**
 * Recomputes `content_items.alias_of_id` for the whole archive: groups
 * pages that are the same underlying resource under URL-normalization
 * (Tier A: scheme/host-case/`index.{ext}`-suffix variance) or a
 * body-hash-confirmed trailing-slash variance (Tier B), and points every
 * non-representative member of each group at the elected representative.
 *
 * **Transitivity**: Tier A and Tier B are each a canonical-key function
 * (`computeTierAAliasKey`/`computeTierBAliasKey`) — grouping by exact key
 * equality is definitionally an equivalence relation. But the *union* of two
 * different equivalence relations (a page linked to another via Tier A, and
 * to a third via Tier B) is not automatically transitive on its own. The
 * grouping closes that gap explicitly with union-find: every Tier A bucket
 * and every Tier B bucket contributes "same group" edges, and the
 * connected components of that combined edge set are — by the graph-theory
 * definition of a connected component — always a transitive partition. See
 * ARCHITECTURE.md's "URL の自然順は、2 件ずつ比べる比較関数ではなく
 * バイト列キーの全順序で決める" for the pairwise-comparator failure mode
 * this design avoids.
 *
 * **`title_text_id` gate**: both tiers additionally require the candidate
 * rows to share the same `page_meta.title_text_id` — a page whose title
 * differs is never merged, regardless of how strong the URL/body signal is.
 * Candidates with a `NULL` title are excluded from the query entirely (not
 * bucketed), so two title-less pages never spuriously merge on a `null ===
 * null` grouping key.
 *
 * **Where the work happens**: the keys, the grouping and the election of each
 * group's representative (most in-group `<link rel="canonical">`
 * declarations pointing at it, then the shortest URL, then the smallest URL
 * by UTF-16 order) run in the native addon (`groupAliasCandidates`), which
 * parses each URL once for both keys. The candidates cross as columns of ids
 * and bytes, not as objects.
 *
 * **Writes**: the assignments are staged in a connection-local TEMP table in
 * chunks and written by one `UPDATE`, inside one transaction — one statement
 * over the staged rows instead of one `UPDATE` per page.
 *
 * **Full recompute, not backfill-only**: unlike `backfillBodyHashFromHtmlBlobs`
 * (which only ever fills a `NULL` cell), this function resets every existing
 * `alias_of_id` to `NULL` and recomputes the whole archive on every call.
 * A backfill-only design cannot react correctly to a newly-crawled page
 * joining an existing group (it might become the new shortest-URL or
 * self-canonical representative) or to an existing group's membership
 * changing across `crawl --append`/`--resume`. Recomputing the whole
 * candidate set each time is idempotent and always reflects the archive's
 * current state.
 * @param accessor - Writable archive accessor.
 * @param onProgress - Optional callback with `(processed, total)` counts of
 *   assignments, invoked after each staged chunk and once more with
 *   `(total, total)` when the `UPDATE` has run, for archives large enough
 *   that visible progress matters. Not called when there is nothing to assign.
 * @example
 * await backfillAliasOfId(accessor, (processed, total) => {
 *   console.error(`alias_of_id backfill: ${processed}/${total}`);
 * });
 */
export async function backfillAliasOfId(
	accessor: ArchiveAccessor,
	onProgress?: (processed: number, total: number) => void,
): Promise<void> {
	const knex = accessor.getKnex();

	const candidates = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('page_meta as pm', 'pm.page_id', 'ci.id')
		.where({ 'ci.scraped': 1, 'ci.is_external': 0 })
		.whereNull('ci.redirect_dest_id')
		.whereNotNull('pm.title_text_id')
		.select<AliasCandidateRow[]>(
			'ci.id as id',
			'ur.url as url',
			'ci.url_id as urlId',
			'pm.title_text_id as titleTextId',
			'pm.canonical_url_id as canonicalUrlId',
			'pm.body_hash as bodyHash',
		);

	// Normalized in place: a second array of candidate objects would double
	// the rows' footprint.
	for (const row of candidates) {
		row.bodyHash = normalizeBodyHash(row.bodyHash);
	}
	const representatives = groupAliasCandidates(
		candidates as (AliasCandidateRow & { bodyHash: Uint8Array | null })[],
	);

	const assignments: { member_id: number; representative_id: number }[] = [];
	for (const [index, representative] of representatives.entries()) {
		if (representative !== -1) {
			assignments.push({
				member_id: candidates[index]!.id,
				representative_id: candidates[representative]!.id,
			});
		}
	}

	const total = assignments.length;

	await knex.transaction(async (trx) => {
		// Reset first so a group that shrinks or reshuffles never leaves a
		// stale pointer from a previous run — every write below is therefore
		// always into an already-NULL cell. It shares the transaction with the
		// writes and runs only after the grouping succeeded, so a failure
		// anywhere leaves the previous pointers in place instead of a cleared
		// column.
		await trx('content_items').whereNotNull('alias_of_id').update({ alias_of_id: null });
		if (total === 0) {
			return;
		}
		await trx.raw(`DROP TABLE IF EXISTS temp.${STAGING_TABLE}`);
		await trx.raw(
			`CREATE TEMP TABLE ${STAGING_TABLE} (member_id INTEGER PRIMARY KEY, representative_id INTEGER NOT NULL)`,
		);
		try {
			let processed = 0;
			for (let start = 0; start < total; start += CHUNK_SIZE) {
				const chunk = assignments.slice(start, start + CHUNK_SIZE);
				await trx(`temp.${STAGING_TABLE}`).insert(chunk);
				await releaseFinishedStatements();
				processed += chunk.length;
				if (processed < total) {
					onProgress?.(processed, total);
				}
			}
			await trx.raw(
				`UPDATE content_items
				 SET alias_of_id = (
				   SELECT representative_id FROM temp.${STAGING_TABLE}
				   WHERE member_id = content_items.id
				 )
				 WHERE id IN (SELECT member_id FROM temp.${STAGING_TABLE})`,
			);
		} finally {
			await trx.raw(`DROP TABLE IF EXISTS temp.${STAGING_TABLE}`);
		}
	});
	if (total > 0) {
		onProgress?.(total, total);
	}
}
