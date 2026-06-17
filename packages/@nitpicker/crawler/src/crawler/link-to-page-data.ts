import type { Link, PageData } from '../utils/types/types.js';

/**
 * Convert a {@link Link} object into a {@link PageData} structure.
 *
 * Creates a minimal PageData from the link's destination metadata. This is
 * used when a full scrape is not performed (e.g., for external pages when
 * `fetchExternal` is disabled, or when a scrape error produces a fallback
 * result).
 *
 * Missing destination fields are filled with sensible defaults (e.g.,
 * status -1 for unknown, empty arrays for anchors/images, empty string for
 * HTML).
 *
 * beholder 3.0.0 elevated several Meta sub-fields from "optional" to
 * "required array / object": `jsonLd`, `speculationRules`, `tags`, `others`,
 * `originTrial`. The dummy meta object below populates every required slot
 * so downstream consumers (database `#insertJsonLd` / `#insertTags`,
 * `deriveFlatFromMeta`) never hit `undefined` while iterating.
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
			jsonLd: [],
			speculationRules: [],
			tags: { detected: {}, entries: [] },
			others: {
				meta: {},
				property: {},
				httpEquiv: {},
				itemprop: {},
				link: [],
				script: [],
				iframe: [],
			},
			originTrial: [],
		},
		anchorList: [],
		imageList: [],
		html: '',
		isSkipped: false,
	};
}
