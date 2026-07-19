import type knex from 'knex';

/**
 * Inserts one row into each of `pages`, `url_refs`, and `content_items` per
 * requested id so downstream inserts against tables that FK to
 * `content_items(id)` (`anchor_edges`, `image_items`, `page_meta`, …) satisfy
 * their foreign key without every spec re-authoring the same 20 lines of
 * seed logic.
 *
 * Shared by 0.13 check specs (`check-anchor-edges-count.spec.ts`,
 * `check-anchor-edges-sum.spec.ts`, `check-image-items-count.spec.ts`,
 * `verify-migration.spec.ts`) so a schema change to
 * pages/url_refs/content_items only requires editing one file. Kept in
 * `populate-entity-tables/test-utils/` alongside {@link setup-entities-db.ts} because that
 * module already provisions the tables this helper writes to.
 *
 * Rows are inserted with defaults suitable for count / structural
 * invariants: `scraped=1`, `isTarget=1`, `isExternal=0`, `source='crawled'`,
 * URL `https://example.com/<id>` and matching `url_refs` row on the same id
 * so `url_id` binds 1:1 with `pages.id` (helpful for URL round-trip specs).
 * @param db - Knex handle from {@link setupMigrationDb}.
 * @param ids - Content-item ids to create. Ordering does not matter but the
 *   helper does not deduplicate the input list — callers should pass
 *   distinct ids.
 */
export async function seedContentItems(
	db: ReturnType<typeof knex>,
	ids: readonly number[],
): Promise<void> {
	for (const id of ids) {
		await db('pages').insert({
			id,
			url: `https://example.com/${id}`,
			scraped: 1,
			isTarget: 1,
		});
		await db('url_refs').insert({ id, url: `https://example.com/${id}` });
		await db('content_items').insert({
			id,
			url_id: id,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
		});
	}
}
