import type { Knex } from 'knex';

import { MigrationVerificationError } from './types.js';

/**
 * Compares totals reported by 0.13 readers (which query the 0.13
 * entity tables exclusively) against equivalent inline SQL against the
 * still-present legacy write-model tables (`pages` / `anchors` / `images` /
 * `resources` / `resources-referrers`). A mismatch here means either the
 * 0.13 populates lost rows or one of the new reader implementations
 * has a filter/predicate off-by-one relative to its legacy counterpart.
 *
 * This is deliberately lighter than the "byte-identical items array"
 * verification issue #195 acceptance references — running every reader on
 * every archive and diffing full result sets would balloon the migrator's
 * runtime and require importing `@nitpicker/query` back into the crawler
 * package (a dependency inversion). The eight totals below capture every
 * reader whose scope was flagged in issue #195 and catch the classes of
 * regression the 0.13 row-count invariants cannot: predicate drift
 * inside a reader function (e.g. a `WHERE contentType='text/html'` filter
 * silently swapping meaning between `pages.contentType` and
 * `content_type_refs.raw`).
 * @param trx - The open migration transaction.
 * @throws {MigrationVerificationError} If any pair of totals disagrees.
 */
export async function checkReaderParity(trx: Knex): Promise<void> {
	const checks: {
		label: string;
		legacy: () => Promise<number>;
		current: () => Promise<number>;
	}[] = [
		{
			label: 'listPages default (scraped=1, redirect null, html-or-null)',
			legacy: async () =>
				scalar(
					trx('pages')
						.where('scraped', 1)
						.whereNull('redirectDestId')
						.where((qb) => {
							qb.where('isSkipped', 0).orWhereNull('isSkipped');
						})
						.where((qb) => {
							qb.whereNull('contentType').orWhere('contentType', 'text/html');
						})
						.count({ count: '*' }),
				),
			current: async () =>
				scalar(
					trx('content_items as ci')
						.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
						.where('ci.scraped', 1)
						.whereNull('ci.redirect_dest_id')
						.where((qb) => {
							qb.where('ci.is_skipped', 0).orWhereNull('ci.is_skipped');
						})
						.where((qb) => {
							qb.whereNull('ctr.raw').orWhere('ctr.raw', 'text/html');
						})
						.count({ count: '*' }),
				),
		},
		{
			label: 'listImages total',
			legacy: async () => scalar(trx('images').count({ count: '*' })),
			current: async () => scalar(trx('image_items').count({ count: '*' })),
		},
		{
			label: 'listResources total',
			legacy: async () => scalar(trx('resources').count({ count: '*' })),
			current: async () => scalar(trx('resource_items').count({ count: '*' })),
		},
		{
			label: 'listLinks broken (status=404 through redirect)',
			legacy: async () =>
				scalar(
					trx('anchors')
						.join('pages as dest', 'anchors.hrefId', 'dest.id')
						.leftJoin('pages as canonical', 'dest.redirectDestId', 'canonical.id')
						.whereRaw('COALESCE("canonical"."status", "dest"."status") = 404')
						.count({ count: '*' }),
				),
			current: async () =>
				scalar(
					trx('anchor_edges as ae')
						.join('content_items as dest', 'ae.href_page_id', 'dest.id')
						.leftJoin(
							'content_items as canonical',
							'dest.redirect_dest_id',
							'canonical.id',
						)
						.whereRaw('COALESCE("canonical"."status", "dest"."status") = 404')
						.sum({ count: 'ae.count' }),
				),
		},
		{
			label: 'checkHeaders scope (internal html scraped, no redirect)',
			legacy: async () =>
				scalar(
					trx('pages')
						.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
						.whereNull('redirectDestId')
						.count({ count: '*' }),
				),
			current: async () =>
				scalar(
					trx('content_items as ci')
						.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
						.where({
							'ci.scraped': 1,
							'ci.is_external': 0,
							'ctr.raw': 'text/html',
						})
						.whereNull('ci.redirect_dest_id')
						.count({ count: '*' }),
				),
		},
		{
			label: 'findDuplicates(title) group count',
			legacy: async () =>
				scalar(
					trx
						.count({ count: '*' })
						.from(
							trx('pages')
								.select('title')
								.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
								.whereNull('redirectDestId')
								.whereNotNull('title')
								.whereNot('title', '')
								.groupBy('title')
								.having(trx.raw('count(*) > 1'))
								.as('g'),
						),
				),
			current: async () =>
				scalar(
					trx.count({ count: '*' }).from(
						trx('content_items as ci')
							.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
							.join('page_meta as pm', 'pm.page_id', 'ci.id')
							.join('text_refs as tr', 'tr.id', 'pm.title_text_id')
							.select('pm.title_text_id')
							.where({
								'ci.scraped': 1,
								'ci.is_external': 0,
								'ctr.raw': 'text/html',
							})
							.whereNull('ci.redirect_dest_id')
							.whereNotNull('pm.title_text_id')
							.whereNot('tr.text', '')
							.groupBy('pm.title_text_id')
							.having(trx.raw('count(*) > 1'))
							.as('g'),
					),
				),
		},
		{
			label: 'findMismatches(canonical) count',
			legacy: async () =>
				scalar(
					trx('pages')
						.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
						.whereNull('redirectDestId')
						.whereNotNull('canonical')
						.whereNot('canonical', '')
						.whereRaw('canonical != url')
						.count({ count: '*' }),
				),
			current: async () =>
				scalar(
					trx('content_items as ci')
						.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
						.join('page_meta as pm', 'pm.page_id', 'ci.id')
						.join('url_refs as canonical_ur', 'canonical_ur.id', 'pm.canonical_url_id')
						.where({
							'ci.scraped': 1,
							'ci.is_external': 0,
							'ctr.raw': 'text/html',
						})
						.whereNull('ci.redirect_dest_id')
						.whereNotNull('pm.canonical_url_id')
						.whereNot('canonical_ur.url', '')
						.whereRaw('"pm"."canonical_url_id" != "ci"."url_id"')
						.count({ count: '*' }),
				),
		},
		{
			// `getViolations` joins `analysis_violations` → `content_items`
			// → `url_refs` to project the page URL for each violation. The
			// current-path parity check exercises that JOIN chain so a
			// broken FK / missing `content_items` row surfaces here as a
			// row-count discrepancy (the legacy side counts `pages` rows
			// via `analysis_violations.page_id`, so a lost `content_items`
			// row makes the current-side INNER JOIN drop the violation).
			label:
				'getViolations page-URL join (analysis_violations → content_items → url_refs)',
			legacy: async () =>
				scalar(
					trx('analysis_violations as v')
						.join('pages as p', 'p.id', 'v.page_id')
						.count({ count: '*' }),
				),
			current: async () =>
				scalar(
					trx('analysis_violations as v')
						.join('content_items as p', 'p.id', 'v.page_id')
						.join('url_refs as ur', 'ur.id', 'p.url_id')
						.count({ count: '*' }),
				),
		},
	];

	const failures: string[] = [];
	// Zero-vs-zero cannot detect a "populate silently produced no rows"
	// bug, so a check whose LEGACY side returns 0 is skipped rather than
	// counted as pass — the parity check exists to catch predicate drift
	// once both sides have rows to compare. `checkContentItemsCount` etc.
	// already guard the "current is empty when legacy is not" direction
	// upstream in {@link verifyMigration}.
	let comparedChecks = 0;
	for (const { label, legacy, current } of checks) {
		const [legacyValue, currentValue] = await Promise.all([legacy(), current()]);
		if (legacyValue === 0 && currentValue === 0) {
			continue;
		}
		comparedChecks++;
		if (legacyValue !== currentValue) {
			failures.push(`${label}: legacy=${legacyValue}, current=${currentValue}`);
		}
	}
	if (failures.length > 0) {
		throw new MigrationVerificationError({
			check: '#9 reader parity',
			context: {
				failures: failures.join('; '),
				compared_checks: comparedChecks,
			},
		});
	}
}

/**
 * Extracts the single numeric value from a Knex `count()` / `sum()` result.
 * SQLite returns strings for aggregate expressions; we coerce and treat
 * `null` as `0` (an empty aggregate).
 * @param queryBuilder - The pending Knex query that resolves to a single
 *   aggregate row.
 * @returns The aggregate value as a JS number.
 */
async function scalar(queryBuilder: Knex.QueryBuilder): Promise<number> {
	const rows = (await queryBuilder) as { count: number | string | null }[];
	return Number(rows[0]?.count ?? 0);
}
