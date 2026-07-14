import type { MigrationVerificationSummary } from './types.js';
import type { Knex } from 'knex';

import { checkAnchorEdgesCount } from './check-anchor-edges-count.js';
import { checkAnchorEdgesSum } from './check-anchor-edges-sum.js';
import { checkContentItemsCount } from './check-content-items-count.js';
import { checkContentTypePreservation } from './check-content-type-preservation.js';
import { checkImageItemsCount } from './check-image-items-count.js';
import { checkPageMetaCount } from './check-page-meta-count.js';
import { checkReaderParity } from './check-reader-parity.js';
import { checkResourceItemsCount } from './check-resource-items-count.js';
import { checkUrlRoundTrip } from './check-url-round-trip.js';
import { MigrationVerificationError } from './types.js';

/**
 * Runs every 0.13 acceptance invariant against a post-6-D archive and
 * returns the verified row-count summary on success. The migration script
 * (`scripts/migrate-to-0.13.mjs`) calls this **inside** the same
 * `knex.transaction()` block that ran `populateEntityTables` so a thrown
 * {@link MigrationVerificationError} rolls back the entire 6-D populate — ref
 * tables from 6-B stay committed because they live in a separate, additive
 * transaction and never lose facts on re-run.
 *
 * The returned {@link MigrationVerificationSummary} is echoed to stdout by the
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
 * Non-{@link MigrationVerificationError} exceptions from a check (e.g. a
 * transient libsql error or a schema-drift SqliteError) are wrapped in a
 * {@link MigrationVerificationError} so the migration script's `catch` sees a
 * uniform failure surface — otherwise operators grepping stderr for
 * `migration verification failed` would miss driver-side errors.
 * @param trx - Knex instance or transaction connected to the archive
 *   **after** every 0.13 populate step has run. Must be a transaction
 *   in production so ref counts, JOIN samples, and error rollback see the
 *   same snapshot; non-transactional callers (unit tests) work but do not
 *   get snapshot isolation.
 * @returns Row-count summary of the verified archive.
 * @throws {MigrationVerificationError} on the first invariant that does not
 *   hold; subsequent checks are skipped.
 */
export async function verifyMigration(trx: Knex): Promise<MigrationVerificationSummary> {
	try {
		await checkContentItemsCount(trx);
		await checkPageMetaCount(trx);
		await checkAnchorEdgesCount(trx);
		await checkAnchorEdgesSum(trx);
		await checkImageItemsCount(trx);
		await checkResourceItemsCount(trx);
		await checkContentTypePreservation(trx);
		await checkUrlRoundTrip(trx);
		// 0.13: reader-level parity between the pre-6 tables and the
		// new entity tables (see `checkReaderParity` for the eight totals
		// this catches that the row-count checks above miss).
		await checkReaderParity(trx);
	} catch (error) {
		if (error instanceof MigrationVerificationError) {
			throw error;
		}
		throw new MigrationVerificationError({
			check: 'runtime',
			context: {
				underlying_error: error instanceof Error ? error.message : String(error),
			},
		});
	}
	return collectSummary(trx);
}

/**
 * Runs the six row counts that populate {@link MigrationVerificationSummary}.
 * Separate from the invariant checks so those stay side-effect-free asserts,
 * and this runs once at the end when all invariants have already held.
 * @param trx - Same Knex handle passed to {@link verifyMigration}.
 */
async function collectSummary(trx: Knex): Promise<MigrationVerificationSummary> {
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
