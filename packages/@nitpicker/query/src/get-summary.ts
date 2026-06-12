import type { SummaryResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves site-wide summary statistics from the archive.
 * Calculates page counts, status code distribution, and metadata
 * fulfillment rates using SQL-level aggregation for performance.
 * @param accessor - The archive accessor to query.
 * @returns Summary statistics including page counts, status distribution, and metadata rates.
 */
export async function getSummary(accessor: ArchiveAccessor): Promise<SummaryResult> {
	const knex = accessor.getKnex();

	const config = await accessor.getConfig();
	const baseUrl = config.baseUrl;
	const roots = config.roots;

	// This is the PAGES summary. A "page" is an HTML page OR a not-yet-classified
	// row (errored / unreachable, `contentType` null) so broken pages stay counted
	// and their statuses stay in the histogram (the broken-link audit needs them);
	// only KNOWN non-HTML resources (PDF / zip / image) are excluded — they have
	// their own views. `isTarget` is NOT used (an in-scope PDF is `isTarget = 1`).
	// The metadata-fulfillment rates further below use a STRICT `text/html`
	// denominator, since only rendered HTML pages can carry title / description /
	// OGP — counting errored rows there would dilute the rates.
	const totalResult = (await knex('pages')
		.count('id as total')
		.where('scraped', 1)
		.whereNull('redirectDestId')
		.where((qb) => {
			qb.whereNull('contentType').orWhere('contentType', 'text/html');
		})) as { total: number }[];

	const internalResult = (await knex('pages')
		.count('id as internalCount')
		.where({ scraped: 1, isExternal: 0 })
		.whereNull('redirectDestId')
		.where((qb) => {
			qb.whereNull('contentType').orWhere('contentType', 'text/html');
		})) as { internalCount: number }[];

	const externalResult = (await knex('pages')
		.count('id as externalCount')
		.where({ scraped: 1, isExternal: 1 })
		.whereNull('redirectDestId')
		.where((qb) => {
			qb.whereNull('contentType').orWhere('contentType', 'text/html');
		})) as { externalCount: number }[];

	const statusRows = (await knex('pages')
		.select('status')
		.count('id as count')
		.where('scraped', 1)
		.whereNull('redirectDestId')
		.where((qb) => {
			qb.whereNull('contentType').orWhere('contentType', 'text/html');
		})
		.groupBy('status')
		.orderBy('status')) as { status: number | null; count: number }[];

	const statusDistribution = statusRows.map((row) => ({
		status: row.status,
		count: Number(row.count),
	}));

	// SQL count() always returns exactly one row
	const totalNum = Number(totalResult[0]?.total ?? 0);
	const internalNum = Number(internalResult[0]?.internalCount ?? 0);

	let metadataFulfillment = {
		title: 0,
		description: 0,
		keywords: 0,
		ogTitle: 0,
		ogDescription: 0,
		ogImage: 0,
	};

	// Metadata fulfillment is over STRICT internal HTML pages only. The denominator
	// (`metaTotal`) is computed by the SAME query as the numerators — NOT reused
	// from `internalNum` (which now includes errored/unreachable rows that can
	// never carry metadata and would dilute every rate).
	const metaRows = (await knex('pages')
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
		.whereNull('redirectDestId')) as Record<string, number>[];

	const meta = metaRows[0] ?? ({} as Record<string, number>);
	const metaTotal = Number(meta.total ?? 0);

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

	return {
		baseUrl,
		roots,
		totalPages: totalNum,
		internalPages: internalNum,
		externalPages: Number(externalResult[0]?.externalCount ?? 0),
		statusDistribution,
		metadataFulfillment,
	};
}
