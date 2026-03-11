import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Result of querying which pages reference a specific resource.
 */
interface ResourceReferrerResult {
	/** The resource URL. */
	resourceUrl: string;
	/** The page URLs that reference this resource. */
	pageUrls: string[];
	/** Total number of referencing pages. */
	total: number;
}

/**
 * Retrieves which pages reference a specific resource URL.
 * @param accessor - The archive accessor to query.
 * @param resourceUrl - The URL of the resource to look up.
 * @returns The resource URL and the list of pages that reference it, or null if not found.
 */
export async function getResourceReferrers(
	accessor: ArchiveAccessor,
	resourceUrl: string,
): Promise<ResourceReferrerResult | null> {
	const knex = accessor.getKnex();

	const [resource] = await knex('resources')
		.select('id')
		.where('url', resourceUrl)
		.limit(1);

	if (!resource) {
		return null;
	}

	const rows = await knex('resources-referrers')
		.select('pages.url')
		.join('pages', 'pages.id', '=', 'resources-referrers.pageId')
		.where('resources-referrers.resourceId', resource.id);

	const pageUrls = rows.map((row: { url: string }) => row.url);

	return {
		resourceUrl,
		pageUrls,
		total: pageUrls.length,
	};
}
