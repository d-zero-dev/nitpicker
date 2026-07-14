import type { Phase6VerificationSummary } from './types.js';
import type { Knex } from 'knex';

import { checkAnchorEdgesCount } from './check-anchor-edges-count.js';
import { checkAnchorEdgesSum } from './check-anchor-edges-sum.js';
import { checkContentItemsCount } from './check-content-items-count.js';
import { checkContentTypePreservation } from './check-content-type-preservation.js';
import { checkImageItemsCount } from './check-image-items-count.js';
import { checkPageMetaCount } from './check-page-meta-count.js';
import { checkResourceItemsCount } from './check-resource-items-count.js';
import { checkUrlRoundTrip } from './check-url-round-trip.js';
import { Phase6VerificationError } from './types.js';

/**
 * Runs every Phase 6-E acceptance invariant against a post-6-D archive and
 * returns the verified row-count summary on success. The migration script
 * (`scripts/migrate-to-phase6.mjs`) calls this **inside** the same
 * `knex.transaction()` block that ran `populatePhase6DEntities` so a thrown
 * {@link Phase6VerificationError} rolls back the entire 6-D populate — ref
 * tables from 6-B stay committed because they live in a separate, additive
 * transaction and never lose facts on re-run.
 *
 * The returned {@link Phase6VerificationSummary} is echoed to stdout by the
 * migration script so operators can eyeball migration outcomes (`did we lose
 * rows silently within the invariant window?`) from batch pipeline logs
 * without re-opening the archive. Called must run this inside a `db.transaction()`
 * for the counts and the JOIN-based checks (#7 / #8) to see a consistent
 * snapshot of the archive.
 *
 * Checks run sequentially in issue #194's numbered order so error messages
 * pinpoint the earliest broken invariant. Sequential (rather than parallel)
 * execution keeps the failure diagnostics focused: fanning eight COUNTs out
 * at once would return the first-completed rejection rather than the
 * lowest-numbered one, which surprises operators reading migration logs.
 * The individual COUNT queries are fast enough at any real archive scale
 * for sequential wall-clock cost to be irrelevant.
 *
 * Non-{@link Phase6VerificationError} exceptions from a check (e.g. a
 * transient libsql error or a schema-drift SqliteError) are wrapped in a
 * {@link Phase6VerificationError} so the migration script's `catch` sees a
 * uniform failure surface — otherwise operators grepping stderr for
 * `Phase 6 verification failed` would miss driver-side errors.
 * @param trx - Knex instance or transaction connected to the archive
 *   **after** every Phase 6-D populate step has run. Must be a transaction
 *   in production so ref counts, JOIN samples, and error rollback see the
 *   same snapshot; non-transactional callers (unit tests) work but do not
 *   get snapshot isolation.
 * @returns Row-count summary of the verified archive.
 * @throws {Phase6VerificationError} on the first invariant that does not
 *   hold; subsequent checks are skipped.
 */
export async function verifyPhase6Migration(
	trx: Knex,
): Promise<Phase6VerificationSummary> {
	try {
		await checkContentItemsCount(trx);
		await checkPageMetaCount(trx);
		await checkAnchorEdgesCount(trx);
		await checkAnchorEdgesSum(trx);
		await checkImageItemsCount(trx);
		await checkResourceItemsCount(trx);
		await checkContentTypePreservation(trx);
		await checkUrlRoundTrip(trx);
	} catch (error) {
		if (error instanceof Phase6VerificationError) {
			throw error;
		}
		throw new Phase6VerificationError({
			check: 'runtime',
			context: {
				underlying_error: error instanceof Error ? error.message : String(error),
			},
		});
	}
	return collectSummary(trx);
}

/**
 * Runs the six row counts that populate {@link Phase6VerificationSummary}.
 * Separate from the invariant checks so those stay side-effect-free asserts,
 * and this runs once at the end when all invariants have already held.
 * @param trx - Same Knex handle passed to {@link verifyPhase6Migration}.
 */
async function collectSummary(trx: Knex): Promise<Phase6VerificationSummary> {
	const [contentItems, pageMeta, anchorEdges, anchorEdgesSum, imageItems, resourceItems] =
		await Promise.all([
			countOf(trx, 'content_items'),
			countOf(trx, 'page_meta'),
			countOf(trx, 'anchor_edges'),
			sumOf(trx, 'anchor_edges', 'count'),
			countOf(trx, 'image_items'),
			countOf(trx, 'resource_items'),
		]);
	return {
		contentItems,
		pageMeta,
		anchorEdges,
		anchorEdgesSum,
		imageItems,
		resourceItems,
	};
}

/**
 * `SELECT count(*) FROM <table>` returning a plain number.
 * @param trx - Knex handle.
 * @param table - Table to count.
 */
async function countOf(trx: Knex, table: string): Promise<number> {
	const rows = await trx(table).count<{ n: number }[]>({ n: '*' });
	return Number(rows[0]!.n);
}

/**
 * `SELECT SUM(<column>) FROM <table>` returning a plain number (`null` sum
 * on an empty table collapses to zero).
 * @param trx - Knex handle.
 * @param table - Table to sum over.
 * @param column - Column to sum.
 */
async function sumOf(trx: Knex, table: string, column: string): Promise<number> {
	const rows = await trx(table).sum<{ n: number | null }[]>({ n: column });
	return Number(rows[0]!.n ?? 0);
}
