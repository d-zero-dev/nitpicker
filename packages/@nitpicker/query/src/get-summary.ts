import type { ContentTypeCategory, ContentTypeCount, SummaryResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { classifyContentType } from './classify-content-type.js';

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
	// in its own query.
	const [pageRows, metaRows, contentTypeRows] = await Promise.all([
		knex('pages')
			.select('isExternal', 'status')
			.count('id as count')
			.where('scraped', 1)
			.whereNull('redirectDestId')
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
			.groupBy('contentType', 'isExternal') as Promise<
			{
				contentType: string | null;
				isExternal: 0 | 1;
				count: number | string;
			}[]
		>,
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
	const statusDistribution = [...statusAcc.entries()]
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
	const contentTypeAcc = new Map<
		ContentTypeCategory,
		{ internal: number; external: number }
	>();
	for (const row of contentTypeRows) {
		const category = classifyContentType(row.contentType);
		const bucket = contentTypeAcc.get(category) ?? { internal: 0, external: 0 };
		const n = Number(row.count);
		if (row.isExternal) {
			bucket.external += n;
		} else {
			bucket.internal += n;
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
		statusDistribution,
		metadataFulfillment,
		contentTypeDistribution,
	};
}
