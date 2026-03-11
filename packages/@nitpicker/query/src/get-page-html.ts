import type { ArchiveAccessor } from '@nitpicker/crawler';

/** Default maximum number of characters to return from an HTML snapshot. */
const DEFAULT_MAX_LENGTH = 100_000;

/**
 * Retrieves the HTML snapshot of a page from the archive.
 * Supports truncation to limit response size for large pages.
 * @param accessor - The archive accessor to query.
 * @param url - The URL of the page whose HTML to retrieve.
 * @param maxLength - Maximum number of characters to return. Defaults to 100,000.
 * @returns An object with the HTML content and truncation status, or null if not found.
 */
export async function getPageHtml(
	accessor: ArchiveAccessor,
	url: string,
	maxLength: number = DEFAULT_MAX_LENGTH,
): Promise<{ html: string; truncated: boolean } | null> {
	const knex = accessor.getKnex();

	const [page] = await knex('pages').select('html').where('url', url).limit(1);
	if (!page?.html) {
		return null;
	}

	const html = await accessor.getHtmlOfPage(page.html);
	if (!html) {
		return null;
	}

	const truncated = html.length > maxLength;
	return {
		html: truncated ? html.slice(0, maxLength) : html,
		truncated,
	};
}
