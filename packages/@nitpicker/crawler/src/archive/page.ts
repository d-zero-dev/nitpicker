import type { ArchiveAccessor } from './archive-accessor.js';
import type { JsonLdRow, JsonLdSummary, TagRow, TagsSummary } from './meta/types.js';
import type {
	Anchor,
	Redirect,
	Referrer,
	DB_Anchor,
	DB_Page,
	DB_Redirect,
	DB_Referrer,
} from './types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { isHtmlContentType } from '../crawler/is-html-content-type.js';
import { parseResponseHeaders } from '../utils/object/parse-response-headers.js';

import { summarizeJsonLd } from './meta/summarize-jsonld.js';
import { summarizeTags } from './meta/summarize-tags.js';

/**
 * Subset of {@link DB_Page} that maps to the flat meta columns derived from
 * beholder's nested Meta. Used by {@link Page.metaFlat} so consumers can
 * iterate every meta column without enumerating each one.
 *
 * Keep in sync with {@link import('./meta/types.js').FlatPageMetaColumns} —
 * one row of `pages` has the same shape.
 */
const FLAT_META_COLUMNS = [
	'lang',
	'dir',
	'charset',
	'baseHref',
	'viewport_raw',
	'themeColor',
	'applicationName',
	'author',
	'generator',
	'publisher',
	'title',
	'description',
	'keywords',
	'robots_raw',
	'robots_noindex',
	'robots_nofollow',
	'robots_noarchive',
	'robots_noimageindex',
	'googlebot',
	'canonical',
	'amphtml',
	'manifest',
	'icon_href',
	'appleTouchIcon_href',
	'og_type',
	'og_title',
	'og_url',
	'og_site_name',
	'og_description',
	'og_image',
	'og_image_alt',
	'og_image_width',
	'og_image_height',
	'og_locale',
	'og_article_published_time',
	'og_article_modified_time',
	'twitter_card',
	'twitter_site',
	'twitter_creator',
	'twitter_title',
	'twitter_description',
	'twitter_image',
	'fb_app_id',
	'verification_google',
	'formatDetection_telephone',
	'tag_count',
	'jsonld_count',
	'tags_providers_csv',
	'main_content_node_name',
	'main_content_id',
	'main_content_role',
	'main_content_selector',
	'main_content_class_list',
	'main_content_word_count',
	'main_content_body_word_count',
	'main_content_heading_count',
	'main_content_image_count',
	'main_content_table_count',
	'main_content_button_count',
	'main_content_iframe_count',
	'main_content_video_count',
	'main_content_audio_count',
	'main_content_canvas_count',
	'scroll_height_desktop',
	'scroll_height_mobile',
] as const satisfies ReadonlyArray<keyof DB_Page>;

/**
 * Represents a crawled page stored in the archive.
 *
 * Provides typed getters for the most-used meta columns (title, canonical,
 * og:*, twitter_card, robots flags, lang), plus {@link Page.metaFlat} as an
 * iterable view over all ~47 flat meta columns and {@link Page.metaExtras} for
 * the JSON catch-all of nested sub-objects not flattened to columns.
 *
 * JSON-LD entries and Wappalyzer tag rows live in dedicated tables and are
 * fetched on demand via {@link Page.getJsonLd} / {@link Page.getTags} (lazy reads, same
 * pattern as {@link Page.getAnchors}).
 *
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
	 * The canonical URL from `<link rel="canonical">` (absolutised against the
	 * page URL at write time), or null if not present.
	 */
	get canonical() {
		return this.#raw.canonical;
	}

	/**
	 * The `<meta charset>` value, or null if not present.
	 */
	get charset() {
		return this.#raw.charset;
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
	 * UNIX ms timestamp of the first time this page row was inserted, or
	 * null for legacy rows. Survives `resetFailedPages` so the discovery
	 * time of a page is preserved across retries.
	 */
	get firstCrawledAt() {
		return this.#raw.firstCrawledAt;
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
	 * Number of JSON-LD + SpeculationRules entries detected on this page
	 * (denormalised aggregate written at scrape time).
	 */
	get jsonldCount() {
		return this.#raw.jsonld_count;
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
	 * UNIX ms timestamp of the most recent successful scrape for this page,
	 * or null for legacy rows / never-scraped pages.
	 */
	get lastCrawledAt() {
		return this.#raw.lastCrawledAt;
	}

	/**
	 * Detected main-content element's `nodeName` (e.g. `'MAIN'`), or null when
	 * no main region was found or the page was not fully rendered.
	 */
	get mainContentNodeName() {
		return this.#raw.main_content_node_name;
	}

	/**
	 * Detected main-content element's `id`, or null.
	 */
	get mainContentId() {
		return this.#raw.main_content_id;
	}

	/**
	 * Detected main-content element's `role` attribute, or null.
	 */
	get mainContentRole() {
		return this.#raw.main_content_role;
	}

	/**
	 * Diagnostic tag+id+class selector for the detected main-content element, or null.
	 */
	get mainContentSelector() {
		return this.#raw.main_content_selector;
	}

	/**
	 * Detected main-content element's CSS classes, or null when no main region
	 * was found. Parsed from the JSON-encoded `main_content_class_list` column.
	 */
	get mainContentClassList(): string[] | null {
		if (this.#raw.main_content_class_list === null) {
			return null;
		}
		return JSON.parse(this.#raw.main_content_class_list) as string[];
	}

	/**
	 * Character count of the main region's text content (denormalised
	 * aggregate written at scrape time), or null.
	 */
	get mainContentWordCount() {
		return this.#raw.main_content_word_count;
	}

	/**
	 * Character count of `document.body`'s text content (denormalised
	 * aggregate written at scrape time), or null.
	 */
	get mainContentBodyWordCount() {
		return this.#raw.main_content_body_word_count;
	}

	/**
	 * Number of headings within the main region (denormalised aggregate), or null.
	 */
	get mainContentHeadingCount() {
		return this.#raw.main_content_heading_count;
	}

	/**
	 * Number of images within the main region (denormalised aggregate), or null.
	 */
	get mainContentImageCount() {
		return this.#raw.main_content_image_count;
	}

	/**
	 * Number of tables within the main region (denormalised aggregate), or null.
	 */
	get mainContentTableCount() {
		return this.#raw.main_content_table_count;
	}

	/**
	 * Number of button-like elements within the main region (denormalised
	 * aggregate), or null.
	 */
	get mainContentButtonCount() {
		return this.#raw.main_content_button_count;
	}

	/**
	 * Number of iframes within the main region (denormalised aggregate), or null.
	 */
	get mainContentIframeCount() {
		return this.#raw.main_content_iframe_count;
	}

	/**
	 * Number of videos within the main region (denormalised aggregate), or null.
	 */
	get mainContentVideoCount() {
		return this.#raw.main_content_video_count;
	}

	/**
	 * Number of audios within the main region (denormalised aggregate), or null.
	 */
	get mainContentAudioCount() {
		return this.#raw.main_content_audio_count;
	}

	/**
	 * Number of canvases within the main region (denormalised aggregate), or null.
	 */
	get mainContentCanvasCount() {
		return this.#raw.main_content_canvas_count;
	}

	/**
	 * Iterable view over every flat meta column (~47 fields). Returns a frozen
	 * record so consumers can pick fields by name without re-enumerating
	 * typed getters.
	 *
	 * Use the typed getters for high-frequency fields (title, canonical, og_*
	 * etc.); use `metaFlat` for bulk projection (Sheets row generation,
	 * `toJSON`, debug dumps).
	 */
	get metaFlat(): Readonly<
		Record<(typeof FLAT_META_COLUMNS)[number], string | number | null>
	> {
		const out: Record<string, string | number | null> = {};
		for (const col of FLAT_META_COLUMNS) {
			out[col] = this.#raw[col];
		}
		return Object.freeze(out) as Readonly<
			Record<(typeof FLAT_META_COLUMNS)[number], string | number | null>
		>;
	}

	/**
	 * Parsed `meta_extras` JSON: nested Meta sub-objects (referrer, viewport,
	 * httpEquiv, og.image[], twitter.*, apple.*, msapplication.*, geo,
	 * citation, link.alternateHreflang[], others.*, etc.) that were not
	 * flattened to dedicated columns.
	 *
	 * Returns an empty object when the column is null or invalid JSON.
	 */
	get metaExtras(): Record<string, unknown> {
		const raw = this.#raw.meta_extras;
		if (raw === null) return {};
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
			return {};
		} catch {
			return {};
		}
	}

	/**
	 * Open Graph description, or null if not present.
	 */
	get og_description() {
		return this.#raw.og_description;
	}

	/**
	 * Open Graph image URL (first image when og:image is multi-valued;
	 * absolutised against the page URL at write time), or null if not present.
	 */
	get og_image() {
		return this.#raw.og_image;
	}

	/**
	 * Open Graph site name, or null if not present.
	 */
	get og_site_name() {
		return this.#raw.og_site_name;
	}

	/**
	 * Open Graph title, or null if not present.
	 */
	get og_title() {
		return this.#raw.og_title;
	}

	/**
	 * Open Graph type, or null if not present.
	 */
	get og_type() {
		return this.#raw.og_type;
	}

	/**
	 * Open Graph URL (absolutised), or null if not present.
	 */
	get og_url() {
		return this.#raw.og_url;
	}

	/**
	 * The parsed HTTP response headers as a key-value record.
	 * Header values may be arrays for multi-value headers (e.g. `set-cookie`).
	 * Returns an empty object if headers are absent or cannot be parsed.
	 */
	get responseHeaders(): Record<string, string | string[] | undefined> {
		return parseResponseHeaders(this.#raw.responseHeaders) ?? {};
	}

	/**
	 * Whether the robots:noarchive directive is set.
	 */
	get robots_noarchive() {
		return !!this.#raw.robots_noarchive;
	}

	/**
	 * Whether the robots:nofollow directive is set.
	 */
	get robots_nofollow() {
		return !!this.#raw.robots_nofollow;
	}

	/**
	 * Whether the robots:noindex directive is set.
	 */
	get robots_noindex() {
		return !!this.#raw.robots_noindex;
	}

	/**
	 * Raw `<meta name="robots">` content, or null if not present.
	 * Use for diagnostics; specific directive flags live on `robots_*` getters.
	 */
	get robots_raw() {
		return this.#raw.robots_raw;
	}

	/**
	 * `document.body.scrollHeight` at the desktop-compact preset (denormalised
	 * aggregate written at scrape time), or null.
	 */
	get scrollHeightDesktop() {
		return this.#raw.scroll_height_desktop;
	}

	/**
	 * `document.body.scrollHeight` at the mobile-small preset (denormalised
	 * aggregate written at scrape time), or null.
	 */
	get scrollHeightMobile() {
		return this.#raw.scroll_height_mobile;
	}

	/**
	 * The reason this page was skipped during crawling, or null if it was not skipped.
	 */
	get skipReason() {
		return this.#raw.skipReason;
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
	 * Number of Wappalyzer tag entries detected on this page (denormalised
	 * aggregate written at scrape time).
	 */
	get tagCount() {
		return this.#raw.tag_count;
	}

	/**
	 * Sorted unique Wappalyzer provider names, comma-separated, empty string
	 * when no tags. Denormalised aggregate; for the structured form fetch
	 * {@link Page.getTags} (lazy).
	 */
	get tagsProvidersCsv() {
		return this.#raw.tags_providers_csv ?? '';
	}

	/**
	 * The page title from the `<title>` element.
	 * Returns an empty string if no title is set.
	 */
	get title() {
		return this.#raw.title || '';
	}

	/**
	 * Twitter Card type (`twitter:card`), or null if not present.
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
	 * Retrieves the audios within this page's detected main content region
	 * from `page_main_content_audios`. Lazy — runs a single SELECT per call.
	 * @returns Ordered audio rows.
	 */
	async getAudios() {
		return this.#archive.getAudiosOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the button-like elements within this page's detected main
	 * content region from `page_main_content_buttons`. Lazy — runs a single
	 * SELECT per call.
	 * @returns Ordered button rows.
	 */
	async getButtons() {
		return this.#archive.getButtonsOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the canvases within this page's detected main content region
	 * from `page_main_content_canvases`. Lazy — runs a single SELECT per call.
	 * @returns Ordered canvas rows.
	 */
	async getCanvases() {
		return this.#archive.getCanvasesOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the headings within this page's detected main content region
	 * from `page_main_content_headings`. Lazy — runs a single SELECT per call.
	 * @returns Ordered heading rows.
	 */
	async getHeadings() {
		return this.#archive.getHeadingsOfPage(this.#raw.id);
	}

	/**
	 * Thin wrapper that forwards this page's id to the accessor's
	 * BLOB-read path. Lets callers hold a `Page` reference and ask for its
	 * HTML without having to thread the page id through.
	 * @returns The HTML content, or `null` if no snapshot was saved.
	 * @see {@link ArchiveAccessor.getHtmlOfPage} for the resolution rules.
	 * @example
	 * for (const page of await archive.getPages()) {
	 *   const html = await page.getHtml();
	 *   if (html !== null) processBody(html);
	 * }
	 */
	async getHtml() {
		return this.#archive.getHtmlOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the iframes within this page's detected main content region
	 * from `page_main_content_iframes`. Lazy — runs a single SELECT per call.
	 * @returns Ordered iframe rows.
	 */
	async getIframes() {
		return this.#archive.getIframesOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the JSON-LD entries for this page from `page_jsonld`.
	 * Lazy — runs a single SELECT per call. Returns entries in insertion
	 * order (matches the scraper's traversal order).
	 * @returns Ordered JSON-LD / SpeculationRules rows.
	 */
	async getJsonLd(): Promise<readonly JsonLdRow[]> {
		return this.#archive.getJsonLdOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the images within this page's detected main content region
	 * from `page_main_content_images`. Lazy — runs a single SELECT per call.
	 * Distinct from the whole-page image scan (`image_items`).
	 * @returns Ordered image rows.
	 */
	async getMainContentImages() {
		return this.#archive.getMainContentImagesOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the tables within this page's detected main content region
	 * from `page_main_content_tables`. Lazy — runs a single SELECT per call.
	 * @returns Ordered table rows.
	 */
	async getMainContentTables() {
		return this.#archive.getMainContentTablesOfPage(this.#raw.id);
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
		const refs = await this.#archive.getReferrersOfPage(this.#raw.id);
		return refs.map((r) => ({
			url: r.url,
			through: r.through,
			throughId: r.throughId,
			hash: r.hash,
			textContent: r.textContent || '',
		}));
	}
	/**
	 * Retrieves all request referrers for this page directly from the database.
	 * Unlike {@link getReferrers}, this always queries the database and does not use pre-loaded data.
	 * @returns An array of {@link Referrer} objects.
	 */
	async getRequests(): Promise<Referrer[]> {
		const refs = await this.#archive.getReferrersOfPage(this.#raw.id);
		return refs.map((r) => ({
			url: r.url,
			through: r.through,
			throughId: r.throughId,
			hash: r.hash,
			textContent: r.textContent || '',
		}));
	}
	/**
	 * Retrieves the Wappalyzer tag rows for this page from `page_tags`.
	 * Lazy — runs a single SELECT per call.
	 * @returns Ordered tag rows.
	 */
	async getTags(): Promise<readonly TagRow[]> {
		return this.#archive.getTagsOfPage(this.#raw.id);
	}

	/**
	 * Retrieves the videos within this page's detected main content region
	 * from `page_main_content_videos`. Lazy — runs a single SELECT per call.
	 * @returns Ordered video rows.
	 */
	async getVideos() {
		return this.#archive.getVideosOfPage(this.#raw.id);
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
		return isHtmlContentType(this.contentType);
	}

	/**
	 * Serializes the page data to a plain JSON object including the full flat
	 * meta column set, the `meta_extras` catch-all, and **summaries** of the
	 * JSON-LD and tag rows.
	 *
	 * Summaries (not raw entries) are inlined so a Page detail payload stays
	 * token-bounded for MCP / LLM consumers — the full `raw` JSON-LD payload
	 * is fetched separately via `getJsonLd()` / the dedicated CLI/MCP
	 * endpoints.
	 *
	 * Anchors and referrers are still resolved eagerly because consumers
	 * (Sheets `eachPage`, viewer detail) depend on having them inline.
	 * @returns A plain object containing all page metadata and relationships.
	 */
	async toJSON() {
		const [anchors, referrers, jsonLdRows, tagRows] = await Promise.all([
			this.getAnchors(),
			this.getReferrers(),
			this.getJsonLd(),
			this.getTags(),
		]);
		const jsonLdSummary: JsonLdSummary = summarizeJsonLd(jsonLdRows);
		const tagsSummary: TagsSummary = summarizeTags(tagRows);
		return {
			url: this.url.href,
			status: this.status,
			statusText: this.statusText,
			contentType: this.contentType,
			contentLength: this.contentLength,
			responseHeaders: this.responseHeaders,
			isExternal: this.isExternal,
			isSkipped: this.isSkipped,
			skipReason: this.skipReason,
			isTarget: this.isTarget,
			firstCrawledAt: this.firstCrawledAt,
			lastCrawledAt: this.lastCrawledAt,
			...this.metaFlat,
			metaExtras: this.metaExtras,
			jsonLd: jsonLdSummary,
			tags: tagsSummary,
			redirectFrom: this.redirectFrom,
			isPage: this.isPage(),
			isInternalPage: this.isInternalPage(),
			getAnchors: anchors,
			getReferrers: referrers,
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
