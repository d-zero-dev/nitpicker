import type {
	ContentTypeCategory,
	ContentTypeCount,
	StatusCount,
	SummaryResult,
} from './types.js';
import type { ArchiveAccessor, ErrorKind } from '@nitpicker/crawler';

import { classifyErrorKind } from '@nitpicker/crawler';

import { classifyContentType } from './classify-content-type.js';
import { excludeSkippedPages } from './exclude-skipped-pages.js';
import { resolveFailedPageMessages } from './resolve-failed-page-messages.js';

/**
 * Retrieves site-wide summary statistics from the archive.
 *
 * The independent SQL aggregations run in parallel via `Promise.all` — they
 * share no state, so serialising them only pays N round-trips for no
 * benefit. The four "page-shaped" counts (total / internal / external /
 * status histogram) are derived from a single `GROUP BY isExternal, status`
 * scan with the HTML-or-null filter, collapsing four full-table aggregations
 * into one. Metadata fulfillment and content-type distribution stay as
 * separate queries because their filters and grouping differ.
 *
 * **SQL-first verified.** The ~22s baseline on a 428k-row archive lives
 * entirely inside the underlying scans (each aggregation is a single
 * full-table scan with no JS post-processing). JS pivots
 * `statusDistribution` cells out of the GROUP BY rows in O(rows-returned)
 * — measured at <50ms — so no JS push-down is available. The cost
 * reduction here requires either more selective indexes per query (none
 * found that the planner picks without ANALYZE) or pre-aggregated
 * summary rows at crawl time (schema change, deferred).
 * @param accessor - The archive accessor to query.
 * @returns Summary statistics including page counts, status distribution,
 *   metadata rates, and content-type distribution.
 */
export async function getSummary(accessor: ArchiveAccessor): Promise<SummaryResult> {
	const knex = accessor.getKnex();
	const config = await accessor.getConfig();
	const baseUrl = config.baseUrl;
	const roots = config.roots;

	// Combined page-shaped counts: total/internal/external/statusDistribution
	// all share the same HTML-or-null base predicate; we group once and pivot
	// in JS. The metadata rates use a stricter `text/html`-only filter (errored
	// rows can never carry metadata) so they stay independent. ContentType
	// distribution covers EVERY in-scope row (including PDFs) so it also lives
	// in its own query. The hard-failed page id list runs alongside so the
	// status=-1 errorKind breakdown can be materialised in one waterfall. The
	// `resolveFailedPageMessages` call chains off the failed-id query inside
	// the same Promise.all — so the (often slow) page_errors / crawl_errors /
	// error.log fetches overlap with the meta + content-type aggregations
	// instead of running serially after the all settles.
	const failedPageIdRowsPromise = knex('pages')
		.select('id')
		.where('scraped', 1)
		.where('status', -1)
		.whereNull('redirectDestId') as Promise<{ id: number }[]>;
	const failedPageMessagesPromise = failedPageIdRowsPromise.then((rows) =>
		resolveFailedPageMessages(
			accessor,
			rows.map((r) => r.id),
		),
	);
	const [pageRows, metaRows, contentTypeRows, failedPageIdRows, failedPageMessages] =
		await Promise.all([
			knex('pages')
				.select('isExternal', 'status')
				.count('id as count')
				.where('scraped', 1)
				.whereNull('redirectDestId')
				.where(excludeSkippedPages)
				.where((qb) => {
					qb.whereNull('contentType').orWhere('contentType', 'text/html');
				})
				.groupBy('isExternal', 'status') as Promise<
				{ isExternal: 0 | 1; status: number | null; count: number | string }[]
			>,
			knex('pages')
				.select(
					knex.raw('COUNT(*) as total'),
					knex.raw(
						"COUNT(CASE WHEN title IS NOT NULL AND title != '' THEN 1 END) as hasTitle",
					),
					knex.raw(
						"COUNT(CASE WHEN description IS NOT NULL AND description != '' THEN 1 END) as hasDescription",
					),
					knex.raw(
						"COUNT(CASE WHEN keywords IS NOT NULL AND keywords != '' THEN 1 END) as hasKeywords",
					),
					knex.raw(
						"COUNT(CASE WHEN og_title IS NOT NULL AND og_title != '' THEN 1 END) as hasOgTitle",
					),
					knex.raw(
						"COUNT(CASE WHEN og_description IS NOT NULL AND og_description != '' THEN 1 END) as hasOgDescription",
					),
					knex.raw(
						"COUNT(CASE WHEN og_image IS NOT NULL AND og_image != '' THEN 1 END) as hasOgImage",
					),
				)
				.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
				.whereNull('redirectDestId') as Promise<Record<string, number>[]>,
			knex('pages')
				.select('contentType', 'isExternal')
				.count('id as count')
				.where('scraped', 1)
				.whereNull('redirectDestId')
				// Same exclude-pattern carve-out as the status histogram above
				// — skipped rows would inflate the "Unknown / Errored"
				// bucket without ever having been fetched.
				.where(excludeSkippedPages)
				.groupBy('contentType', 'isExternal') as Promise<
				{
					contentType: string | null;
					isExternal: 0 | 1;
					count: number | string;
				}[]
			>,
			failedPageIdRowsPromise,
			failedPageMessagesPromise,
		]);

	// Pivot pageRows into total/internal/external counts and the status histogram.
	// `totalNum` counts every row (including any row with a NULL `isExternal`,
	// which the schema permits — the crawler always writes 0/1 but defensive at
	// the DB boundary). Internal/external use explicit-value matching so a NULL
	// row goes into neither bucket, never one or the other by truthiness coercion.
	let totalNum = 0;
	let internalNum = 0;
	let externalNum = 0;
	const statusAcc = new Map<number | null, number>();
	for (const row of pageRows) {
		const n = Number(row.count);
		totalNum += n;
		if (row.isExternal === 1) {
			externalNum += n;
		} else if (row.isExternal === 0) {
			internalNum += n;
		}
		statusAcc.set(row.status, (statusAcc.get(row.status) ?? 0) + n);
	}
	const statusDistribution: StatusCount[] = [...statusAcc.entries()]
		.map(([status, count]) => ({ status, count }))
		.toSorted((a, b) => {
			// `null` status (errored / not-yet-classified) bubbles to the end;
			// numeric statuses sort ascending so the histogram reads 200 → 301 → 404.
			if (a.status === null) {
				return 1;
			}
			if (b.status === null) {
				return -1;
			}
			return a.status - b.status;
		});

	// status=-1 breakdown: classify each hard-failed page by its underlying
	// message and attach a per-kind histogram to the `-1` row. `failedPageMessages`
	// was already resolved in parallel with the other aggregations above, so
	// here we just iterate the failed ids and bucket them. Pages with no
	// recorded message fall into `'unknown'`, keeping `sum(breakdown) === count`.
	const minusOneEntry = statusDistribution.find((e) => e.status === -1);
	if (minusOneEntry && failedPageIdRows.length > 0) {
		const kindCounts = new Map<ErrorKind, number>();
		for (const row of failedPageIdRows) {
			const message = failedPageMessages.get(row.id) ?? '';
			const kind = message === '' ? 'unknown' : classifyErrorKind(message);
			kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
		}
		minusOneEntry.errorKindBreakdown = [...kindCounts.entries()]
			.map(([kind, count]) => ({ kind, count }))
			.toSorted((a, b) => b.count - a.count);
	}

	const meta = metaRows[0] ?? ({} as Record<string, number>);
	const metaTotal = Number(meta.total ?? 0);
	let metadataFulfillment = {
		title: 0,
		description: 0,
		keywords: 0,
		ogTitle: 0,
		ogDescription: 0,
		ogImage: 0,
	};
	if (metaTotal > 0) {
		metadataFulfillment = {
			title: Number(meta.hasTitle) / metaTotal,
			description: Number(meta.hasDescription) / metaTotal,
			keywords: Number(meta.hasKeywords) / metaTotal,
			ogTitle: Number(meta.hasOgTitle) / metaTotal,
			ogDescription: Number(meta.hasOgDescription) / metaTotal,
			ogImage: Number(meta.hasOgImage) / metaTotal,
		};
	}

	// Content-Type distribution: GROUP BY raw contentType + isExternal in SQL
	// (bounded by the number of distinct MIME strings), then map through
	// `classifyContentType` in JS so the canonical category lives in exactly
	// one place — matching the SQL filter the Pages view uses.
	//
	// While walking the same rows we also aggregate the "all in-scope rows
	// regardless of MIME" totals (`internalContents` / `externalContents`).
	// Doing it here avoids a separate SQL round-trip — the contentType
	// query already covers every isExternal value with no MIME filter.
	//
	// IMPORTANT: the contentTypeRows query above already applies
	// `whereNull('redirectDestId')` so redirect-destination rows do NOT
	// inflate the totals (every redirect endpoint would otherwise count
	// twice — once as the source, once as the resolved target). If you
	// ever relax that filter on the SQL, also re-evaluate this loop:
	// `internalContents` and `externalContents` are now defined as
	// "every non-redirect-resolved row".
	const contentTypeAcc = new Map<
		ContentTypeCategory,
		{ internal: number; external: number }
	>();
	let internalContents = 0;
	let externalContents = 0;
	for (const row of contentTypeRows) {
		const category = classifyContentType(row.contentType);
		const bucket = contentTypeAcc.get(category) ?? { internal: 0, external: 0 };
		const n = Number(row.count);
		/* Strict equality matches `pageRows` above (lines 94–98) — a row
		   with NULL `isExternal` (the schema permits it; the writer always
		   writes 0/1 but we stay defensive at the DB boundary) goes into
		   neither bucket, so `internalContents` / `externalContents` agree
		   with `internalPages` / `externalPages` on what "internal" means.
		   Truthy/falsy coercion would put NULL rows into internal here while
		   the pageRows loop dropped them entirely. */
		if (row.isExternal === 1) {
			bucket.external += n;
			externalContents += n;
		} else if (row.isExternal === 0) {
			bucket.internal += n;
			internalContents += n;
		}
		contentTypeAcc.set(category, bucket);
	}
	const contentTypeDistribution: ContentTypeCount[] = [...contentTypeAcc.entries()]
		.map(([category, { internal, external }]) => ({ category, internal, external }))
		.toSorted((a, b) => {
			// Primary: descending total count (most common category leads the chart).
			const totalDelta = b.internal + b.external - (a.internal + a.external);
			if (totalDelta !== 0) {
				return totalDelta;
			}
			// Tie-breaker: ascending category name so equal-count categories appear
			// in a deterministic order across runs / SQLite plan changes.
			return a.category.localeCompare(b.category);
		});

	return {
		baseUrl,
		roots,
		totalPages: totalNum,
		internalPages: internalNum,
		externalPages: externalNum,
		internalContents,
		externalContents,
		statusDistribution,
		metadataFulfillment,
		contentTypeDistribution,
	};
}
