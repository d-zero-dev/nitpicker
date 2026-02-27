import type { ArchiveAccessor } from './archive-accessor.js';
import type { DB_Anchor, DB_Page, DB_Redirect, DB_Referrer } from './types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

/**
 * Represents a crawled page stored in the archive.
 *
 * Provides access to the page's metadata (title, status, SEO tags, etc.),
 * its relationships (anchors, referrers, redirects), and its HTML snapshot.
 * Instances are created by {@link ArchiveAccessor.getPages} or
 * {@link ArchiveAccessor.getPagesWithRefs}.
 */
export default class Page {
	/**
	 * An array of URLs that redirect to this page.
	 * Each entry contains the source URL and its page ID.
	 * Returns an empty array if no redirects exist.
	 */
	readonly redirectFrom: Redirect[];
	#archive: ArchiveAccessor;
	#disableQueries: boolean;
	#raw: DB_Page;
	#rawAnchors: DB_Anchor[] | null;
	#rawReferrers: DB_Referrer[] | null;

	/**
	 * The alternate URL from the `<link rel="alternate">` tag, or null if not present.
	 */
	get alternate() {
		return this.#raw.alternate;
	}

	/**
	 * The canonical URL from the `<link rel="canonical">` tag, or null if not present.
	 */
	get canonical() {
		return this.#raw.canonical;
	}

	/**
	 * The content length of the HTTP response in bytes, or null if unknown.
	 */
	get contentLength() {
		return this.#raw.contentLength;
	}

	/**
	 * The MIME content type of the HTTP response (e.g., `"text/html"`), or null if unknown.
	 */
	get contentType() {
		return this.#raw.contentType;
	}

	/**
	 * The meta description content, or null if not present.
	 */
	get description() {
		return this.#raw.description;
	}

	/**
	 * Whether this page is on an external domain (outside the crawl scope).
	 */
	get isExternal() {
		return !!this.#raw.isExternal;
	}

	/**
	 * Whether this page was skipped during crawling.
	 */
	get isSkipped() {
		return !!this.#raw.isSkipped;
	}

	/**
	 * Whether this page was a crawl target (as opposed to being discovered incidentally).
	 */
	get isTarget() {
		return !!this.#raw.isTarget;
	}

	/**
	 * The reason this page was skipped during crawling, or null if it was not skipped.
	 */
	get skipReason() {
		return this.#raw.skipReason;
	}

	/**
	 * The meta keywords content, or null if not present.
	 */
	get keywords() {
		return this.#raw.keywords;
	}

	/**
	 * The `lang` attribute value from the HTML element, or null if not present.
	 */
	get lang() {
		return this.#raw.lang;
	}

	/**
	 * Whether the noarchive robots directive is set.
	 */
	get noarchive() {
		return !!this.#raw.noarchive;
	}

	/**
	 * Whether the nofollow robots directive is set.
	 */
	get nofollow() {
		return !!this.#raw.nofollow;
	}

	/**
	 * Whether the noindex robots directive is set.
	 */
	get noindex() {
		return !!this.#raw.noindex;
	}

	/**
	 * The Open Graph description (`og:description`), or null if not present.
	 */
	get og_description() {
		return this.#raw.og_description;
	}

	/**
	 * The Open Graph image URL (`og:image`), or null if not present.
	 */
	get og_image() {
		return this.#raw.og_image;
	}

	/**
	 * The Open Graph site name (`og:site_name`), or null if not present.
	 */
	get og_site_name() {
		return this.#raw.og_site_name;
	}

	/**
	 * The Open Graph title (`og:title`), or null if not present.
	 */
	get og_title() {
		return this.#raw.og_title;
	}

	/**
	 * The Open Graph type (`og:type`), or null if not present.
	 */
	get og_type() {
		return this.#raw.og_type;
	}

	/**
	 * The Open Graph URL (`og:url`), or null if not present.
	 */
	get og_url() {
		return this.#raw.og_url;
	}

	/**
	 * The parsed HTTP response headers as a key-value record.
	 * Returns an empty object if headers cannot be parsed.
	 */
	get responseHeaders(): Record<string, string> {
		try {
			return JSON.parse(this.#raw.responseHeaders);
		} catch {
			return {};
		}
	}

	/**
	 * The HTTP response status code, or null if the page has not been fetched.
	 */
	get status() {
		return this.#raw.status;
	}

	/**
	 * The HTTP response status text (e.g., `"OK"`, `"Not Found"`), or null if not fetched.
	 */
	get statusText() {
		return this.#raw.statusText;
	}

	/**
	 * The page title from the `<title>` element.
	 * Returns an empty string if no title is set.
	 */
	get title() {
		return this.#raw.title || '';
	}

	/**
	 * The Twitter Card type (`twitter:card`), or null if not present.
	 */
	get twitter_card() {
		return this.#raw.twitter_card;
	}

	/**
	 * The parsed URL of this page as an ExURL object.
	 * Respects the `disableQueries` option for query string handling.
	 */
	get url() {
		return parseUrl(this.#raw.url, {
			disableQueries: this.#disableQueries,
		})!;
	}

	/**
	 * Creates a new Page instance.
	 * @param archive - The ArchiveAccessor used for lazy-loading relationships.
	 * @param raw - The raw database row for this page.
	 * @param rawRedirects - Pre-loaded redirect records, or undefined for lazy loading.
	 * @param rawAnchors - Pre-loaded anchor records, or undefined for lazy loading.
	 * @param rawReferrers - Pre-loaded referrer records, or undefined for lazy loading.
	 * @param disableQueries - Whether to strip query strings from the URL.
	 */
	constructor(
		archive: ArchiveAccessor,
		raw: DB_Page,
		rawRedirects?: DB_Redirect[],
		rawAnchors?: DB_Anchor[],
		rawReferrers?: DB_Referrer[],
		disableQueries?: boolean,
	) {
		this.#archive = archive;
		this.#raw = raw;
		this.redirectFrom = (rawRedirects || []).map((r) => ({
			url: r.from,
			pageId: r.fromId,
		}));
		this.#rawAnchors = rawAnchors || null;
		this.#rawReferrers = rawReferrers || null;
		this.#disableQueries = disableQueries ?? false;
	}

	/**
	 * Retrieves the anchors (outgoing links) found on this page.
	 * Uses pre-loaded data if available, otherwise queries the database.
	 * @returns An array of {@link Anchor} objects representing the links on this page.
	 */
	async getAnchors(): Promise<Anchor[]> {
		if (this.#rawAnchors) {
			return this.#rawAnchors.map((a) => ({
				url: a.url,
				href: a.href,
				isExternal: !!a.isExternal,
				title: a.title,
				status: a.status,
				statusText: a.statusText,
				contentType: a.contentType,
				hash: a.hash,
				textContent: a.textContent,
			}));
		}
		return this.#archive.getAnchorsOnPage(this.#raw.id);
	}

	/**
	 * Reads the HTML snapshot content of this page from the archive.
	 * @returns The HTML content as a string, or null if no snapshot was saved.
	 */
	async getHtml() {
		return this.#archive.getHtmlOfPage(this.#raw.html);
	}

	/**
	 * Retrieves the referrers (incoming links) pointing to this page.
	 * Uses pre-loaded data if available, otherwise queries the database.
	 * @returns An array of {@link Referrer} objects representing pages that link to this page.
	 */
	async getReferrers(): Promise<Referrer[]> {
		if (this.#rawReferrers) {
			return this.#rawReferrers.map((r) => ({
				url: r.url,
				through: r.through,
				throughId: r.throughId,
				hash: r.hash,
				textContent: r.textContent || '',
			}));
		}
		return this.#archive.getReferrersOfPage(this.#raw.id);
	}

	/**
	 * Retrieves all request referrers for this page directly from the database.
	 * Unlike {@link getReferrers}, this always queries the database and does not use pre-loaded data.
	 * @returns An array of {@link Referrer} objects.
	 */
	async getRequests(): Promise<Referrer[]> {
		return this.#archive.getReferrersOfPage(this.#raw.id);
	}

	/**
	 * Checks whether this page is an internal HTML page (not external and has `text/html` content type).
	 * @returns `true` if this is an internal HTML page, `false` otherwise.
	 */
	isInternalPage() {
		return this.isPage() && !this.isExternal;
	}

	/**
	 * Checks whether this entry represents an HTML page (content type is `text/html`).
	 * @returns `true` if the content type is `text/html`, `false` otherwise.
	 */
	isPage() {
		const type = this.contentType || '';
		return type.toLowerCase().trim() === 'text/html';
	}

	/**
	 * Serializes the page data to a plain JSON object,
	 * including resolved anchors and referrers.
	 * @returns A plain object containing all page metadata and relationships.
	 */
	async toJSON() {
		return {
			url: this.url.href,
			title: this.title,
			status: this.status,
			statusText: this.statusText,
			contentType: this.contentType,
			contentLength: this.contentLength,
			responseHeaders: this.responseHeaders,
			isExternal: this.isExternal,
			isSkipped: this.isSkipped,
			skipReason: this.skipReason,
			isTarget: this.isTarget,
			lang: this.lang,
			description: this.description,
			keywords: this.keywords,
			noindex: this.noindex,
			nofollow: this.nofollow,
			noarchive: this.noarchive,
			canonical: this.canonical,
			alternate: this.alternate,
			twitter_card: this.twitter_card,
			og_site_name: this.og_site_name,
			og_url: this.og_url,
			og_title: this.og_title,
			og_description: this.og_description,
			og_type: this.og_type,
			og_image: this.og_image,
			redirectFrom: this.redirectFrom,
			isPage: this.isPage(),
			isInternalPage: this.isInternalPage(),
			getAnchors: await this.getAnchors(),
			getReferrers: await this.getReferrers(),
		};
	}
}

/**
 * Utility type that extracts the resolved type from a Promise.
 */
type PromiseType<T> = T extends PromiseLike<infer U> ? U : T;

/**
 * The static (serialized) representation of a Page, as returned by {@link Page.toJSON}.
 */
export type StaticPageData = PromiseType<ReturnType<Page['toJSON']>>;

/**
 * Represents a page that links to another page (an incoming link).
 */
export interface Referrer {
	/** The URL of the referring page. */
	url: string;
	/** The URL through which the referral passes (may differ due to redirects). */
	through: string;
	/** The page ID corresponding to the through URL. */
	throughId: number;
	/** The URL fragment (hash) of the referring link, or null if not present. */
	hash: string | null;
	/** The text content of the referring anchor element. */
	textContent: string;
}

/**
 * Represents an outgoing link (anchor element) found on a page.
 */
export interface Anchor {
	/** The resolved destination URL of the anchor. */
	url: string;
	/** The original href attribute value of the anchor element. */
	href: string;
	/** Whether the anchor points to an external domain. */
	isExternal: boolean;
	/** The title attribute of the anchor element, or null if not present. */
	title: string | null;
	/** The HTTP status code of the linked page, or null if not yet fetched. */
	status: number | null;
	/** The HTTP status text of the linked page, or null if not yet fetched. */
	statusText: string | null;
	/** The content type of the linked page, or null if not yet fetched. */
	contentType: string | null;
	/** The URL fragment (hash) portion of the link, or null if not present. */
	hash: string | null;
	/** The text content of the anchor element, or null if empty. */
	textContent: string | null;
}

/**
 * Represents a page that redirects to this page.
 */
export interface Redirect {
	/** The URL of the redirect source page. */
	url: string;
	/** The database ID of the redirect source page. */
	pageId: number;
}
