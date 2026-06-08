import type { ResourceLookupResult } from './types.js';
import type { PageData } from '../utils/types/types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { isHtmlContentType } from './is-html-content-type.js';

/**
 * Parameters for {@link resourceToPageData}.
 */
interface ResourceToPageDataParams {
	/** The queued URL being processed. */
	readonly url: ExURL;
	/** Whether the URL is external to the crawl scope. */
	readonly isExternal: boolean;
	/** The recorded sub-resource data captured during page rendering. */
	readonly resource: ResourceLookupResult;
}

/**
 * Synthesize {@link PageData} from a recorded sub-resource row, or return
 * `null` when the resource is not eligible for reuse.
 *
 * Eligible: the status is 2xx AND the content type is known and not
 * `text/html`. Non-2xx rows (redirect hops, errors, 304s) and HTML rows must
 * fall back to the normal HEAD pre-flight / browser scrape, which also
 * guarantees that `redirectPaths: []` here is accurate — a URL that
 * redirects is recorded with its 3xx status and never reaches this path.
 * @param params - The queued URL, its external flag, and the recorded resource data.
 * @returns The synthesized page data, or `null` when the caller must fall back.
 */
export function resourceToPageData(params: ResourceToPageDataParams): PageData | null {
	const { url, isExternal, resource } = params;

	if (
		resource.status == null ||
		resource.status < 200 ||
		resource.status >= 300 ||
		resource.contentType == null ||
		isHtmlContentType(resource.contentType)
	) {
		return null;
	}

	return {
		url,
		redirectPaths: [],
		isTarget: !isExternal,
		isExternal,
		status: resource.status,
		statusText: resource.statusText ?? '',
		contentType: resource.contentType,
		contentLength: resource.contentLength,
		responseHeaders: resource.responseHeaders,
		meta: {
			title: '',
		},
		anchorList: [],
		imageList: [],
		html: '',
		isSkipped: false,
	};
}
