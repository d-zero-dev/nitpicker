import type { ArchiveAccessor } from '@nitpicker/crawler';

/** Default maximum number of characters to return from an HTML snapshot. */
const DEFAULT_MAX_LENGTH = 100_000;

/**
 * Looks the page up by URL and returns its stored HTML body, optionally
 * truncated. Truncation lets MCP / viewer callers cap response size for
 * pages whose body would otherwise blow past their JSON / payload limits
 * (large generated documents can exceed several MB).
 * @param accessor - The archive accessor to query.
 * @param url - The URL of the page whose HTML to retrieve.
 * @param maxLength - Maximum number of characters to return.
 * @returns The HTML and a `truncated` flag, or `null` when the URL is
 *   unknown to the archive OR the page has no stored body.
 * @example
 * const result = await getPageHtml(accessor, 'https://example.com/');
 * if (result === null) return notFound();
 * if (result.truncated) warn('body truncated to maxLength');
 * return result.html;
 */
export async function getPageHtml(
	accessor: ArchiveAccessor,
	url: string,
	maxLength: number = DEFAULT_MAX_LENGTH,
): Promise<{ html: string; truncated: boolean } | null> {
	const knex = accessor.getKnex();

	const [page] = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ci.id as id')
		.where('ur.url', url)
		.limit(1);
	if (!page) {
		return null;
	}

	const html = await accessor.getHtmlOfPage(page.id);
	if (html === null) {
		return null;
	}

	const truncated = html.length > maxLength;
	return {
		html: truncated ? html.slice(0, maxLength) : html,
		truncated,
	};
}
