import type { Knex } from 'knex';

import { excludeSkippedPages } from './exclude-skipped-pages.js';

/** Named parameters for {@link applyPageListUniverse}. */
export interface ApplyPageListUniverseOptions {
	/**
	 * Alias the `content_items` table carries in the query being constrained
	 * (e.g. `ci`). Every predicate below is qualified with it.
	 */
	readonly alias: string;
	/**
	 * `fromList` archives only: the `content_items.id` set an internal row
	 * must belong to (see `computeFromListAllowedPageIds`). `null` or
	 * `undefined` means "no restriction". An **empty** set restricts to
	 * nothing — the same fail-safe `computeFromListAllowedPageIds` documents.
	 *
	 * Bound as ONE JSON-array parameter consumed by `json_each`, so the set
	 * size never approaches SQLite's variable-count ceiling and the predicate
	 * composes with `GROUP BY` aggregations.
	 */
	readonly allowedInternalPageIds?: ReadonlySet<number> | null;
}

/**
 * Constrains a `content_items` query to the row universe the Page List
 * (`viewer_pages`) is built from, so Summary counts and Page List counts
 * agree structurally.
 *
 * The universe is: scraped rows that are crawl targets, external, or
 * redirect sources; never alias-merged rows; never skipped rows; and, on a
 * `fromList` archive, internal rows only when they belong to
 * `allowedInternalPageIds`. External rows are never restricted by the
 * `fromList` rule.
 *
 * Deliberately NOT part of the universe: `status = 404` handling and
 * Content-Type filtering. Those are per-consumer rules (Summary excludes 404
 * from totals; Pages keeps 404 rows), so each caller applies its own.
 * @param qb - The query builder to constrain. Mutated in place.
 * @param options - See {@link ApplyPageListUniverseOptions}.
 * @example
 * const qb = knex('content_items as ci').count('ci.id as count');
 * applyPageListUniverse(qb, { alias: 'ci', allowedInternalPageIds });
 */
export function applyPageListUniverse(
	qb: Knex.QueryBuilder,
	options: ApplyPageListUniverseOptions,
): void {
	const { alias, allowedInternalPageIds } = options;
	qb.where(`${alias}.scraped`, 1)
		.where((inner) =>
			inner
				.where(`${alias}.is_target`, 1)
				.orWhere(`${alias}.is_external`, 1)
				.orWhereNotNull(`${alias}.redirect_dest_id`),
		)
		.whereNull(`${alias}.alias_of_id`)
		.where((inner) => excludeSkippedPages(inner, `${alias}.is_skipped`));
	if (allowedInternalPageIds) {
		qb.where((inner) =>
			inner
				.where(`${alias}.is_external`, 1)
				.orWhereRaw(`"${alias}"."id" IN (SELECT value FROM json_each(?))`, [
					JSON.stringify([...allowedInternalPageIds]),
				]),
		);
	}
}
