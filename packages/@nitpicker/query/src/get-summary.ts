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

	const totalResult = (await knex('pages')
		.count('id as total')
		.where('scraped', 1)
		.whereNull('redirectDestId')) as { total: number }[];

	const internalResult = (await knex('pages')
		.count('id as internalCount')
		.where({ scraped: 1, isExternal: 0 })
		.whereNull('redirectDestId')) as { internalCount: number }[];

	const externalResult = (await knex('pages')
		.count('id as externalCount')
		.where({ scraped: 1, isExternal: 1 })
		.whereNull('redirectDestId')) as { externalCount: number }[];

	const statusRows = (await knex('pages')
		.select('status')
		.count('id as count')
		.where('scraped', 1)
		.whereNull('redirectDestId')
		.groupBy('status')
		.orderBy('status')) as { status: number | null; count: number }[];

	const statusDistribution = statusRows.map((row) => ({
		status: row.status,
		count: Number(row.count),
	}));

	const totalNum = Number(totalResult[0]!.total);
	const internalNum = Number(internalResult[0]!.internalCount);

	let metadataFulfillment = {
		title: 0,
		description: 0,
		keywords: 0,
		ogTitle: 0,
		ogDescription: 0,
		ogImage: 0,
	};

	if (internalNum > 0) {
		const metaRows = (await knex('pages')
			.select(
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
			.where({ scraped: 1, isExternal: 0 })
			.whereNull('redirectDestId')) as Record<string, number>[];

		const meta = metaRows[0]!;
		metadataFulfillment = {
			title: Number(meta.hasTitle) / internalNum,
			description: Number(meta.hasDescription) / internalNum,
			keywords: Number(meta.hasKeywords) / internalNum,
			ogTitle: Number(meta.hasOgTitle) / internalNum,
			ogDescription: Number(meta.hasOgDescription) / internalNum,
			ogImage: Number(meta.hasOgImage) / internalNum,
		};
	}

	return {
		baseUrl,
		totalPages: totalNum,
		internalPages: internalNum,
		externalPages: Number(externalResult[0]!.externalCount),
		statusDistribution,
		metadataFulfillment,
	};
}
