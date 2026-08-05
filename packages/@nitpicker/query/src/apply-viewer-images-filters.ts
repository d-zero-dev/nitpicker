import type { ListViewerImagesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';
import { toFlagValues } from './to-flag-values.js';

/**
 * Applies every `ListViewerImagesOptions` filter as `WHERE` predicates on a
 * `viewer_images`-scoped query builder. Shared by the id-resolution query
 * and the total-count query so both see exactly the same row set.
 *
 * Every predicate here targets an indexed or plain `viewer_images` column
 * (never the wide write-model `images` table, and never a large text
 * column like `src`/`alt`/`sourceCode`) — this function runs BEFORE any
 * join, on the narrow read model only; the wide table's large text columns
 * are joined in only after LIMIT, once the row set is small, so the wide
 * read stays bounded.
 *
 * `oversizedThreshold` is evaluated at request time against the raw
 * `natural_width`/`natural_height` columns rather than a precomputed
 * boolean flag at a single hard-coded threshold — `listImages`'s
 * `oversizedThreshold` accepts an arbitrary caller-supplied pixel count,
 * and the fast path must preserve that flexibility rather than narrowing
 * it. There is
 * deliberately no dedicated covering index for this filter (see
 * `createViewerReadModelIndexes`'s docs) — it is a residual OR scan with no
 * index to assist it, over a table with no large text columns, still far
 * cheaper than the live path's scan of the wide `images` table plus its
 * covering index.
 * @param qb - A Knex query builder scoped to `viewer_images` (or a subquery
 *   selecting from it).
 * @param options - The filter options to apply.
 */
export function applyViewerImagesFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerImagesOptions,
): void {
	applyEqualityOrInFilter(qb, 'missing_alt', toFlagValues(options.missingAlt));
	applyEqualityOrInFilter(
		qb,
		'missing_dimensions',
		toFlagValues(options.missingDimensions),
	);
	if (options.oversizedThreshold != null) {
		const threshold = options.oversizedThreshold;
		qb.where((inner) => {
			inner
				.where('natural_width', '>', threshold)
				.orWhere('natural_height', '>', threshold);
		});
	}
}
