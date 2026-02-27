import type { Link, PageData } from '../utils/index.js';

/**
 * Convert a {@link Link} object into a {@link PageData} structure.
 *
 * Creates a minimal PageData from the link's destination metadata. This is used
 * when a full scrape is not performed (e.g., for external pages when
 * `fetchExternal` is disabled, or when a scrape error produces a fallback result).
 *
 * Missing destination fields are filled with sensible defaults (e.g., status -1
 * for unknown, empty arrays for anchors/images, empty string for HTML).
 * @param link - The link to convert, containing URL and optional destination metadata.
 * @returns A PageData object populated from the link's available data.
 */
export function linkToPageData(link: Link): PageData {
	return {
		url: link.url,
		redirectPaths: link.dest?.redirectPaths || [],
		isTarget: !link.isExternal,
		isExternal: link.isExternal,
		status: link.dest?.status || -1,
		statusText: link.dest?.statusText || 'UnknownError',
		contentType: link.dest?.contentType || null,
		contentLength: link.dest?.contentLength || null,
		responseHeaders: link.dest?.responseHeaders || null,
		meta: {
			title: link.dest?.title || '',
		},
		anchorList: [],
		imageList: [],
		html: '',
		isSkipped: false,
	};
}
