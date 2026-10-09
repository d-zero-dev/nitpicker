/**
 * Shared type definitions for archive-side meta processing helpers under {@link ./}.
 *
 * Mirrors the shape of {@link Meta} after archive-side
 * derivation: flat columns persisted to the `pages` table, denormalised
 * aggregates, per-row shapes for `page_jsonld` / `page_tags`, and the summary
 * objects returned by `get-page-detail` consumers.
 * @module
 */

import { compareSemver } from './compare-semver.js';

/**
 * Flat columns of the `pages` table derived from {@link Meta}.
 *
 * Each field maps to a single SQL column (string / number / boolean / null).
 * URL-shaped columns are absolutised by the deriver before persistence so
 * downstream consumers (e.g. `find-mismatches`) can compare against the
 * absolute page URL directly.
 * @see derive-flat-from-meta.ts
 * @example
 * // A `pages` row projected onto (a subset of) its flat meta columns:
 * const meta: Partial<FlatPageMetaColumns> = {
 *   title: 'Home',
 *   canonical: 'https://example.com/',
 *   robots_noindex: 0,
 *   og_type: 'website',
 * };
 */
export interface FlatPageMetaColumns {
	// Document basics
	lang: string | null;
	dir: string | null;
	charset: string | null;
	baseHref: string | null;
	viewport_raw: string | null;
	themeColor: string | null;
	applicationName: string | null;
	author: string | null;
	generator: string | null;
	publisher: string | null;

	// Robots
	robots_raw: string | null;
	robots_noindex: number | null;
	robots_nofollow: number | null;
	robots_noarchive: number | null;
	robots_noimageindex: number | null;
	googlebot: string | null;

	// Link (1:1 only; array shapes live in meta_extras)
	canonical: string | null;
	amphtml: string | null;
	manifest: string | null;
	icon_href: string | null;
	appleTouchIcon_href: string | null;

	// Open Graph
	og_type: string | null;
	og_title: string | null;
	og_url: string | null;
	og_site_name: string | null;
	og_description: string | null;
	og_image: string | null;
	og_image_alt: string | null;
	og_image_width: string | null;
	og_image_height: string | null;
	og_locale: string | null;
	og_article_published_time: string | null;
	og_article_modified_time: string | null;

	// Twitter
	twitter_card: string | null;
	twitter_site: string | null;
	twitter_creator: string | null;
	twitter_title: string | null;
	twitter_description: string | null;
	twitter_image: string | null;

	// One-offs
	fb_app_id: string | null;
	verification_google: string | null;
	formatDetection_telephone: number | null;

	// Title (kept here so the deriver writes title alongside other meta fields)
	title: string | null;

	// Description / keywords (top-level Meta fields that map 1:1 to columns)
	description: string | null;
	keywords: string | null;
}

/**
 * Denormalised aggregates computed at write time from `meta.tags` / `meta.jsonLd`.
 *
 * Stored on the `pages` table so list / report read paths can avoid joining
 * `page_tags` / `page_jsonld` for the common "how many?" and "which
 * providers?" questions.
 * @see compute-page-denormalized.ts
 * @example
 * const denorm: PageDenormalizedColumns = {
 *   tag_count: 3,
 *   jsonld_count: 1,
 *   tags_providers_csv: 'Google Analytics,Google Tag Manager',
 * };
 */
export interface PageDenormalizedColumns {
	/** Total Wappalyzer tag entries for the page. */
	tag_count: number;
	/** `meta.jsonLd.length + meta.speculationRules.length`. */
	jsonld_count: number;
	/** Sorted unique providers, comma-separated (empty string when no tags). */
	tags_providers_csv: string;
}

/**
 * Denormalised aggregates computed at write time from beholder's
 * `MainContentsData` / `ScrollHeightData`.
 *
 * Stored on `page_meta` following the same pattern as
 * {@link PageDenormalizedColumns} (`tag_count` / `jsonld_count`): the full
 * per-element detail lives in the `page_main_content_*` child tables, while
 * these scalar columns let list / detail reads answer "how many headings?"
 * without joining them. All fields are `null` when the page was not fully
 * rendered (external / non-HTML / metadata-only scrape) — see
 * `compute-main-contents-denormalized.ts` for the `null`-in-null-out contract.
 * @see compute-main-contents-denormalized.ts
 * @example
 * const denorm: MainContentsDenormalizedColumns = {
 *   main_content_node_name: 'MAIN',
 *   main_content_id: null,
 *   main_content_role: null,
 *   main_content_selector: 'main.l-main',
 *   main_content_class_list: '["l-main"]',
 *   main_content_word_count: 1240,
 *   main_content_body_word_count: 1580,
 *   main_content_heading_count: 6,
 *   main_content_image_count: 3,
 *   main_content_table_count: 0,
 *   main_content_button_count: 1,
 *   main_content_iframe_count: 0,
 *   main_content_video_count: 0,
 *   main_content_audio_count: 0,
 *   main_content_canvas_count: 0,
 *   main_content_custom_element_count: 0,
 *   scroll_height_desktop: 3200,
 *   scroll_height_mobile: 5400,
 *   image_scan_desktop: 0,
 *   image_scan_mobile: 1,
 * };
 */
export interface MainContentsDenormalizedColumns {
	/** Detected main-content element's `nodeName` (e.g. `'MAIN'`), or `null`. */
	main_content_node_name: string | null;
	/** Detected main-content element's `id`, or `null`. */
	main_content_id: string | null;
	/** Detected main-content element's `role` attribute, or `null`. */
	main_content_role: string | null;
	/** Diagnostic tag+id+class selector for the detected element, or `null`. */
	main_content_selector: string | null;
	/** JSON-encoded array of the detected element's CSS classes, or `null`. */
	main_content_class_list: string | null;
	/** Character count of the main region's text content, or `null`. */
	main_content_word_count: number | null;
	/** Character count of `document.body`'s text content, or `null`. */
	main_content_body_word_count: number | null;
	/** Number of headings within the main region, or `null`. */
	main_content_heading_count: number | null;
	/** Number of images within the main region, or `null`. */
	main_content_image_count: number | null;
	/** Number of tables within the main region, or `null`. */
	main_content_table_count: number | null;
	/** Number of button-like elements within the main region, or `null`. */
	main_content_button_count: number | null;
	/** Number of iframes within the main region, or `null`. */
	main_content_iframe_count: number | null;
	/** Number of videos within the main region, or `null`. */
	main_content_video_count: number | null;
	/** Number of audios within the main region, or `null`. */
	main_content_audio_count: number | null;
	/** Number of canvases within the main region, or `null`. */
	main_content_canvas_count: number | null;
	/**
	 * Number of Web Components (custom elements) within the main region, or
	 * `null`. Unlike its siblings above, `null` is not solely "page not
	 * rendered" — it also covers "rendered, but nitpicker's own
	 * `captureCustomElements` best-effort capture failed" (a distinct state
	 * from "captured, zero found" = `0`), since this column is not sourced
	 * from beholder's `MainContentsData` at all. See
	 * `compute-main-contents-denormalized.ts`.
	 */
	main_content_custom_element_count: number | null;
	/** `document.body.scrollHeight` at the desktop-compact preset, or `null`. */
	scroll_height_desktop: number | null;
	/** `document.body.scrollHeight` at the mobile-small preset, or `null`. */
	scroll_height_mobile: number | null;
	/**
	 * `@d-zero/beholder`'s `IMAGE_SCAN_CODE` outcome for the desktop-compact
	 * `<img>` element scan (0=ok, 1=degraded, 2=nav-unsettled, 3=frame-lost,
	 * 4=scroll-height-exceeded, 255=unknown), or `null` when not attempted
	 * (page not fully rendered, or the archive predates this column).
	 */
	image_scan_desktop: number | null;
	/** Same as {@link MainContentsDenormalizedColumns.image_scan_desktop}, for the mobile-small preset. */
	image_scan_mobile: number | null;
}

/**
 * Per-viewport `@d-zero/beholder` `IMAGE_SCAN_CODE` outcome, as passed into
 * `computeMainContentsDenormalized`. Deliberately plain `number | null`
 * rather than beholder's `ImageScanCode` type — this shape is written by
 * `@nitpicker/archive` independently of which `@d-zero/beholder` version is
 * currently installed (see `compute-main-contents-denormalized.ts`).
 */
export interface ImageScanColumns {
	/** Outcome for the desktop-compact viewport, or `null` when not attempted. */
	desktop: number | null;
	/** Outcome for the mobile-small viewport, or `null` when not attempted. */
	mobile: number | null;
}

/**
 * One row in the `page_main_content_headings` table.
 * @example
 * const row: MainContentHeadingRow = { id: 1, pageId: 42, order: 0, text: 'Welcome', level: 1 };
 */
export interface MainContentHeadingRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** Heading text after whitespace removal, or `null` when empty. */
	text: string | null;
	/** Heading level (1-6) from the tag name. */
	level: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * One row in the `page_main_content_images` table.
 * @example
 * const row: MainContentImageRow = {
 *   id: 1,
 *   pageId: 42,
 *   order: 0,
 *   src: 'https://example.com/a.png',
 *   alt: 'A photo',
 * };
 */
export interface MainContentImageRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** Resolved absolute `src` URL. */
	src: string;
	/** `alt` attribute value (may be an empty string). */
	alt: string;
}

/**
 * One row in the `page_main_content_tables` table.
 * @example
 * const row: MainContentTableRow = {
 *   id: 1,
 *   pageId: 42,
 *   order: 0,
 *   rows: 3,
 *   cols: 4,
 *   hasHeader: 1,
 *   hasFooter: 0,
 *   hasMergedCell: 0,
 * };
 */
export interface MainContentTableRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** Number of `<tr>` elements. */
	rows: number;
	/** Number of `th`/`td` cells in the first row. */
	cols: number;
	/** Whether the table contains a `<thead>` (raw SQLite 0/1; knex does not round-trip `.boolean()` columns back to JS `boolean` on read). */
	hasHeader: 0 | 1;
	/** Whether the table contains a `<tfoot>` (raw SQLite 0/1). */
	hasFooter: 0 | 1;
	/** Whether any cell uses `colspan` or `rowspan` (raw SQLite 0/1). */
	hasMergedCell: 0 | 1;
}

/**
 * One row in the `page_main_content_buttons` table.
 * @example
 * const row: MainContentButtonRow = {
 *   id: 1,
 *   pageId: 42,
 *   order: 0,
 *   nodeName: 'BUTTON',
 *   role: null,
 *   type: 'submit',
 *   text: 'Send',
 *   disabled: 0,
 * };
 */
export interface MainContentButtonRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** Element tag name (e.g. `'BUTTON'`, `'A'`, `'DIV'`). */
	nodeName: string;
	/** `role` attribute, or `null` when absent. */
	role: string | null;
	/** `type` for `<button>` / `<input>`, otherwise `null`. */
	type: string | null;
	/** Label text after whitespace removal, or `null` when empty. */
	text: string | null;
	/** `true` when `disabled` or `aria-disabled="true"` (raw SQLite 0/1). */
	disabled: 0 | 1;
}

/**
 * One row in the `page_main_content_iframes` table.
 * @example
 * const row: MainContentIframeRow = {
 *   id: 1,
 *   pageId: 42,
 *   order: 0,
 *   src: 'https://example.com/embed',
 *   title: null,
 *   width: '640',
 *   height: '360',
 * };
 */
export interface MainContentIframeRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** Resolved absolute `src` URL. */
	src: string;
	/** `title` attribute, or `null` when absent. */
	title: string | null;
	/** Raw `width` attribute string, or `null` when absent. */
	width: string | null;
	/** Raw `height` attribute string, or `null` when absent. */
	height: string | null;
}

/**
 * One row in the `page_main_content_videos` table.
 * @example
 * const row: MainContentVideoRow = {
 *   id: 1,
 *   pageId: 42,
 *   order: 0,
 *   src: 'https://example.com/v.mp4',
 *   poster: null,
 *   width: 640,
 *   height: 360,
 * };
 */
export interface MainContentVideoRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** Resolved media URL. */
	src: string;
	/** Resolved `poster` URL, or `null` when unset. */
	poster: string | null;
	/** IDL `width` in pixels. */
	width: number;
	/** IDL `height` in pixels. */
	height: number;
}

/**
 * One row in the `page_main_content_audios` table.
 * @example
 * const row: MainContentAudioRow = { id: 1, pageId: 42, order: 0, src: 'https://example.com/a.mp3' };
 */
export interface MainContentAudioRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** Resolved media URL. */
	src: string;
}

/**
 * One row in the `page_main_content_canvases` table.
 * @example
 * const row: MainContentCanvasRow = { id: 1, pageId: 42, order: 0, width: 300, height: 150 };
 */
export interface MainContentCanvasRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** IDL bitmap width. */
	width: number;
	/** IDL bitmap height. */
	height: number;
}

/**
 * One row in the `page_main_content_custom_elements` table. Unlike its
 * seven `MainContentXxxRow` siblings, the source data is not beholder's
 * `MainContentsData` but nitpicker's own `capture-custom-elements.ts`.
 * @example
 * const row: MainContentCustomElementRow = { id: 1, pageId: 42, order: 0, nodeName: 'MY-WIDGET', elementId: 'widget-1', classList: '["foo"]' };
 */
export interface MainContentCustomElementRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** 0-based DOM traversal order within the main content region. */
	order: number;
	/** The element's `nodeName` (e.g. `'MY-WIDGET'`). */
	nodeName: string;
	/** The element's `id` attribute, or `null`. */
	elementId: string | null;
	/** JSON-encoded array of the element's CSS classes, or `null`. */
	classList: string | null;
}

/**
 * One row in the `page_jsonld` table.
 *
 * Captures both `<script type="application/ld+json">` (`kind = 'ld+json'`) and
 * `<script type="speculationrules">` (`kind = 'speculationrules'`) entries.
 * @see extract-tags-for-archive.ts (sibling for tags) and the table definition
 * in `archive/init-schema.ts`.
 * @example
 * const row: JsonLdRow = {
 *   id: 1,
 *   pageId: 42,
 *   kind: 'ld+json',
 *   type: 'Article',
 *   raw: '{"@type":"Article","headline":"Hello"}',
 *   parsed: { '@type': 'Article', headline: 'Hello' },
 *   parseError: null,
 * };
 */
export interface JsonLdRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `pages.id`. */
	pageId: number;
	/** `'ld+json'` for `application/ld+json` scripts, `'speculationrules'` for speculation rules. */
	kind: 'ld+json' | 'speculationrules';
	/** Top-level `@type` extracted from `parsed`, normalised to a single string. `null` when missing / unparseable. */
	type: string | null;
	/** Original script text content (uncompressed; SQLite overflow pages handle large rows). */
	raw: string;
	/** Parsed JSON object (`null` when `parseError` is set). */
	parsed: unknown | null;
	/** Parse error message preserved from beholder; `null` when the entry parsed cleanly. */
	parseError: string | null;
}

/**
 * Insert shape for {@link JsonLdRow}.
 *
 * Mirrors the row shape minus the auto-increment `id`. `parsed` is the raw
 * JSON value (the database layer JSON-stringifies it before write).
 * @example
 * const insert: JsonLdRowForInsert = {
 *   pageId: 42,
 *   kind: 'speculationrules',
 *   type: null,
 *   raw: '{"prerender":[]}',
 *   parsed: { prerender: [] },
 *   parseError: null,
 * };
 */
export type JsonLdRowForInsert = Omit<JsonLdRow, 'id'>;

/**
 * One row in the `page_tags` table.
 *
 * Each row represents one detected Wappalyzer provider × external-id tuple for
 * one page. A page typically has 1–10 rows.
 * @example
 * const row: TagRow = {
 *   id: 1,
 *   pageId: 42,
 *   provider: 'Google Tag Manager',
 *   category: 'Tag managers',
 *   externalId: 'GTM-XXXX',
 *   version: null,
 *   confidence: 100,
 *   categories: ['Tag managers'],
 *   sources: [
 *     {
 *       type: 'script-src',
 *       src: 'https://www.googletagmanager.com/gtm.js',
 *       location: 'head',
 *     },
 *   ],
 * };
 */
export interface TagRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `pages.id`. */
	pageId: number;
	/** Wappalyzer provider name (e.g. `'Google Tag Manager'`). */
	provider: string;
	/** First entry of `categories`. `null` when Wappalyzer did not report a category. Convenient projection only; canonical list is `categories`. */
	category: string | null;
	/** Real external identifier extracted by `meta/id-extractors` (e.g. `GTM-XXXX`, `G-XXXX`). `null` when none. */
	externalId: string | null;
	/** Wappalyzer-reported version, when available. */
	version: string | null;
	/** Wappalyzer-reported confidence 0–100, when available. */
	confidence: number | null;
	/** Full `categories` array preserved as JSON. */
	categories: readonly string[];
	/** `TagSource[]` preserved as JSON; describes where the provider was detected (script-src / inline / iframe-src / window-global / etc.). */
	sources: ReadonlyArray<{
		type:
			| 'script-src'
			| 'inline'
			| 'iframe-src'
			| 'window-global'
			| 'img-src'
			| 'header'
			| 'meta'
			| 'html';
		src?: string;
		location?: 'head' | 'body' | 'noscript';
		globalName?: string;
	}>;
}

/**
 * Insert shape for {@link TagRow}.
 *
 * Mirrors the row shape minus the auto-increment `id`. `categories` and
 * `sources` are passed as plain JS arrays (the database layer JSON-stringifies
 * them before write).
 * @example
 * const insert: TagRowForInsert = {
 *   pageId: 42,
 *   provider: 'Google Analytics',
 *   category: 'Analytics',
 *   externalId: 'G-XXXX',
 *   version: null,
 *   confidence: 100,
 *   categories: ['Analytics'],
 *   sources: [{ type: 'window-global', globalName: 'gtag' }],
 * };
 */
export type TagRowForInsert = Omit<TagRow, 'id'>;

/**
 * One row in the `technology_signals` table — one un-combined signal for
 * one technology on one page. See
 * `archive/meta/technologies/types.ts#TechnologySignalPartial` for the
 * pre-insert shape (no `pageId`/`id`) this is built from.
 * @example
 * const row: TechnologySignalRow = {
 *   id: 1,
 *   pageId: 42,
 *   technology: 'Next.js',
 *   signalType: 'html-marker',
 *   evidence: '<script id="__NEXT_DATA__"',
 *   weight: 70,
 * };
 */
export interface TechnologySignalRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	/** Normalized technology name (e.g. `'Next.js'`, `'Google Analytics'`). */
	technology: string;
	/** How this signal was detected. */
	signalType:
		| 'wappalyzer'
		| 'meta-generator'
		| 'html-marker'
		| 'url-pattern'
		| 'scoped-attr'
		| 'weak-marker'
		| 'js-license-comment';
	/** Matched fragment or raw value, truncated to ~200 chars, or `null`. */
	evidence: string | null;
	/** This signal's confidence in isolation, 0-100. */
	weight: number;
}

/** Insert shape for {@link TechnologySignalRow}. */
export type TechnologySignalRowForInsert = Omit<TechnologySignalRow, 'id'>;

/**
 * One row in the `page_technologies` table — the confidence-combined
 * roll-up of every {@link TechnologySignalRow} for one technology on one
 * page. Read-optimised counterpart of `technology_signals`, analogous to
 * `page_meta.tag_count` being the roll-up of `page_tags` — except here the
 * roll-up is a full row, not just a count, because `confidence` is a
 * per-technology computed value (`combineTechnologyConfidence`), not a
 * simple count.
 * @example
 * const row: PageTechnologyRow = {
 *   id: 1,
 *   pageId: 42,
 *   technology: 'Next.js',
 *   category: 'JavaScript frameworks',
 *   version: null,
 *   confidence: 80,
 *   signalCount: 2,
 * };
 */
export interface PageTechnologyRow {
	/** Auto-increment primary key. */
	id: number;
	/** FK to `content_items.id`. */
	pageId: number;
	technology: string;
	category: string | null;
	version: string | null;
	/** `combineTechnologyConfidence`'s noisy-OR result, 0-100. */
	confidence: number;
	/** Count of distinct `signalType`s that contributed to `confidence`. */
	signalCount: number;
}

/** Insert shape for {@link PageTechnologyRow}. */
export type PageTechnologyRowForInsert = Omit<PageTechnologyRow, 'id'>;

/**
 * Summary of one page's JSON-LD entries returned by `get-page-detail`.
 *
 * Keeps the response token-bounded for MCP / LLM consumers; the full `raw`
 * payload is fetched separately via `get-page-jsonld(url)`.
 * @see summarize-jsonld.ts
 * @example
 * const summary: JsonLdSummary = {
 *   count: 2,
 *   types: ['Article', 'BreadcrumbList'],
 *   parseErrorCount: 0,
 * };
 */
export interface JsonLdSummary {
	/** Total entries across `ld+json` and `speculationrules`. */
	count: number;
	/** Unique `@type` values (sorted). `null` slots are emitted as the string `'(unknown)'`. */
	types: readonly string[];
	/** Number of entries that failed to parse (i.e. have a non-null `parseError`). */
	parseErrorCount: number;
}

/**
 * Error thrown by `assert-compatible-version` when the archive's
 * `info.version` is older than the format version this build accepts.
 *
 * Catch this at CLI / viewer boundaries to print a friendly message; do not
 * confuse with generic `Error` thrown by `Database.connect` (lockfile / I/O).
 * @example
 * try {
 *   const accessor = await Archive.openCached(filePath);
 * } catch (error) {
 *   if (error instanceof IncompatibleArchiveError) {
 *     // Message names the migration script(s) to run.
 *     console.error(error.message);
 *   } else {
 *     throw error;
 *   }
 * }
 */
export class IncompatibleArchiveError extends Error {
	/**
	 * @param archiveVersion - The `info.version` value read from the archive
	 *   (or `'unknown'` when the column is missing / null).
	 * @param requiredVersion - The minimum format version this build accepts
	 *   (semver string, e.g. `'0.13.0'`).
	 */
	constructor(
		readonly archiveVersion: string,
		readonly requiredVersion: string,
	) {
		super(
			`Archive uses Nitpicker ${archiveVersion}; this build requires ${requiredVersion} or newer. ` +
				`Run ${suggestMigrationScript(archiveVersion)} to produce an upgraded copy next to it.`,
		);
		this.name = 'IncompatibleArchiveError';
	}
}

/**
 * Selects the migration script an operator should run to bring
 * `archiveVersion` up to the current {@link IncompatibleArchiveError.requiredVersion}.
 * Chained: pre-0.10 archives run migrate-to-0.10 first, then
 * migrate-to-0.13 — so the message points at BOTH steps in order.
 * 0.10.0-through-0.12.x archives only need migrate-to-0.13.
 *
 * Uses {@link compareSemver} instead of `<` string comparison: `'0.9.0'`
 * lexicographically compares GREATER than `'0.10.0'` (because `'9' > '1'`),
 * which would misroute pre-0.10 archives into the single-step hint and
 * make the resulting migrator invocation fail with a confusing error.
 * @param archiveVersion - Semver read from `info.version`, or `'unknown'`.
 * @returns Bracketed command string for embedding into the error message.
 */
function suggestMigrationScript(archiveVersion: string): string {
	if (archiveVersion === 'unknown' || compareSemver(archiveVersion, '0.10.0') < 0) {
		return '`node scripts/migrate-to-0.10.mjs <path>` (then `node scripts/migrate-to-0.13.mjs <path>`)';
	}
	return '`node scripts/migrate-to-0.13.mjs <path>`';
}

// ---------------------------------------------------------------------------
// Mirrors of `@d-zero/beholder`'s `Meta` and its sub-types.
//
// Structurally equivalent copies so the archive layer (and every read-only
// consumer of it) does not depend on beholder. The crawler passes beholder's
// `Meta` through unchanged; `@nitpicker/crawler`'s
// `beholder-type-mirror-parity.ts` asserts at build time that each copy is
// identical to the installed beholder's (additions included), so a beholder
// bump must update this section in the same change. See
// `../utils/types/types.ts` for the page-level shapes (`PageData` etc.).
// ---------------------------------------------------------------------------

/**
 * Top-level metadata extracted from a page's `<head>` and surrounding markup
 * (`<html>`, `<base>`, `<noscript>`, `<iframe>` in body, `<script>` of known
 * structured-data types).
 *
 * Required fields (`title`, `jsonLd`, `speculationRules`, `others`, `tags`)
 * always exist so downstream consumers can iterate without null-checking the
 * top level.
 */
export interface Meta {
	/** The text content of the `<title>` element. */
	title: string;

	/** The `lang` attribute of the `<html>` element. */
	lang?: string;
	/** The `dir` attribute of the `<html>` element. */
	dir?: string;
	/** The `xmlns` attribute of the `<html>` element (rare; RDFa contexts). */
	xmlns?: string;
	/** The `prefix` attribute of the `<html>` element (RDFa). */
	prefix?: string;
	/** The `vocab` attribute of the `<html>` element (RDFa). */
	vocab?: string;
	/** The `typeof` attribute of the `<html>` element (RDFa). */
	typeOf?: string;
	/** The `itemtype` attribute of the `<html>` element (Microdata). */
	itemType?: string;
	/** The `<meta charset>` value, or `null` if absent. */
	charset?: string;
	/** The `<base href>` value, or `null` if absent. */
	baseHref?: string;
	/** The `<base target>` value, or `null` if absent. */
	baseTarget?: string;

	/** `<meta name="description">` content. */
	description?: string;
	/** `<meta name="keywords">` content. */
	keywords?: string;
	/** `<meta name="application-name">` content. */
	applicationName?: string;
	/** `<meta name="author">` content. */
	author?: string;
	/** `<meta name="generator">` content. */
	generator?: string;
	/** `<meta name="creator">` content. */
	creator?: string;
	/** `<meta name="publisher">` content. */
	publisher?: string;
	/** `<meta name="theme-color">` (no `media` attribute) content. */
	themeColor?: string;
	/** `<meta name="theme-color" media="(prefers-color-scheme: light)">` content. */
	themeColorLight?: string;
	/** `<meta name="theme-color" media="(prefers-color-scheme: dark)">` content. */
	themeColorDark?: string;
	/** `<meta name="color-scheme">` content. */
	colorScheme?: string;
	/** `<meta name="supported-color-schemes">` content. */
	supportedColorSchemes?: string;

	/** Parsed `<meta name="viewport">`. */
	viewport?: ViewportMeta;
	/** Parsed `<meta name="robots">`. */
	robots?: RobotsMeta;
	/** Parsed `<meta name="referrer">` and its sub-policies. */
	referrer?: ReferrerMeta;
	/** Parsed `<meta name="format-detection">` and Apple cross-references. */
	formatDetection?: FormatDetectionMeta;

	/** `<meta name="googlebot">` and other crawler-specific directives. */
	googlebot?: string;
	googlebotNews?: string;
	googlebotImage?: string;
	googlebotVideo?: string;
	bingbot?: string;
	slurp?: string;
	duckduckbot?: string;
	yandex?: string;
	baiduspider?: string;
	iaArchiver?: string;
	revisitAfter?: string;
	rating?: string;
	distribution?: string;
	classification?: string;
	category?: string;
	subject?: string;
	topic?: string;
	summary?: string;
	abstract?: string;
	audience?: string;
	target?: string;
	copyright?: string;
	designer?: string;
	owner?: string;
	replyTo?: string;
	contact?: string;
	identifierUrl?: string;
	language?: string;
	revision?: string;
	build?: string;
	version?: string;
	handheldFriendly?: string;
	mobileOptimized?: string;
	mobileWebAppCapable?: string;
	applicationUrl?: string;
	theme?: string;

	/** Parsed `http-equiv` attributes. */
	httpEquiv?: HttpEquivMeta;

	/** Open Graph tags (`og:*`, `article:*`, `book:*`, `profile:*`, `music:*`, `video:*`). */
	og?: OpenGraphMeta;
	/** Twitter Card tags (`twitter:*`). */
	twitter?: TwitterMeta;
	/** Facebook tags (`fb:*`). */
	fb?: FbMeta;
	/** Fediverse tags (`fediverse:*`). */
	fediverse?: FediverseMeta;
	/** Apple iOS tags. */
	apple?: AppleMeta;
	/** Microsoft application tile tags (`msapplication-*`). */
	msapplication?: MsApplicationMeta;
	/** Site verification tags. */
	verification?: VerificationMeta;
	/** Google-specific tags (`google`, `google-*`). */
	google?: GoogleMeta;
	/** Dublin Core (`DC.*`) tags. */
	dc?: Record<string, string>;
	/** DC Terms (`DCTERMS.*`) tags. */
	dcterms?: Record<string, string>;
	/** Geo tags. */
	geo?: GeoMeta;
	/** `<meta name="ICBM" content="{lat}, {lng}">` content. */
	icbm?: string;
	/** Academic citation (`citation_*`) tags. */
	citation?: CitationMeta;

	/** CSRF param name (`<meta name="csrf-param">`). */
	csrfParam?: string;
	/** CSRF token (`<meta name="csrf-token">`). */
	csrfToken?: string;

	/** Misc single-value tags. */
	goImport?: string;
	bitcoin?: string;
	originTrial: string[];
	monetization?: string;
	paymentPointer?: string;
	ampExperimentsOptIn?: string;
	ampGoogleClientIdApi?: string;

	/** `<meta itemprop="...">` tags (Microdata in head). */
	itemprop?: {
		name?: string;
		description?: string;
		image?: string;
	} & Record<string, string | string[]>;

	/** Parsed `<link>` elements. */
	link?: LinkMeta;

	/** All `<script type="application/ld+json">` entries. */
	jsonLd: JsonLdEntry[];
	/** All `<script type="speculationrules">` entries. */
	speculationRules: JsonLdEntry[];

	/** RDFa attributes on `<html>` (mirror of top-level fields, kept for explicit access). */
	rdfa?: RdfaMeta;
	/** Microdata attributes on `<html>`. */
	microdata?: MicrodataMeta;

	/** AMP-related markers. */
	amp?: AmpMeta;

	/** Legacy meta tags (kept for completeness). */
	legacy?: LegacyMeta;

	/** Mobile-specific meta tags. */
	mobile?: MobileMeta;

	/** Microformats2 markers in head. */
	microformats?: MicroformatsMeta;

	/** Pinterest-specific tags. */
	pinterest?: PinterestMeta;

	/** Slack/LinkedIn-specific notes (cross-references to og:* tags). */
	slack?: SlackMeta;
	linkedin?: LinkedInMeta;

	/** Experimental / vendor-specific tags. */
	experimental?: ExperimentalMeta;

	/** Wikipedia / MediaWiki-specific tags. */
	wiki?: WikiMeta;

	/** Detected third-party tags (analytics, frameworks, libraries, etc.). */
	tags: TagsMeta;

	/** Unknown / future / vendor-specific markup not covered by typed fields. */
	others: OthersBucket;

	/** Raw head entries for debugging. Only present when `getMeta` is called with `includeRaw: true`. */
	_raw?: readonly RawHeadEntry[];
}

/**
 * Parsed `<meta name="viewport">` content.
 * The `raw` string is always preserved so consumers can re-parse unknown directives.
 */
export interface ViewportMeta {
	raw: string;
	width?: string;
	height?: string;
	initialScale?: number;
	minimumScale?: number;
	maximumScale?: number;
	userScalable?: boolean | string;
	viewportFit?: string;
	interactiveWidget?: string;
}

/**
 * Parsed `<meta name="robots">` and crawler directives.
 */
export interface RobotsMeta {
	raw: string;
	index?: boolean;
	noindex?: boolean;
	follow?: boolean;
	nofollow?: boolean;
	none?: boolean;
	all?: boolean;
	noarchive?: boolean;
	nosnippet?: boolean;
	noimageindex?: boolean;
	nocache?: boolean;
	notranslate?: boolean;
	noodp?: boolean;
	noydir?: boolean;
	indexifembedded?: boolean;
	maxSnippet?: number;
	maxImagePreview?: string;
	maxVideoPreview?: number;
	unavailableAfter?: string;
}

/**
 * Parsed `<meta name="referrer">` and its individual policy values.
 */
export interface ReferrerMeta {
	raw: string;
	noReferrer?: boolean;
	origin?: boolean;
	originWhenCrossOrigin?: boolean;
	strictOrigin?: boolean;
	strictOriginWhenCrossOrigin?: boolean;
	unsafeUrl?: boolean;
	sameOrigin?: boolean;
	noReferrerWhenDowngrade?: boolean;
}

/**
 * Parsed `<meta name="format-detection">` content.
 */
export interface FormatDetectionMeta {
	raw: string;
	telephone?: boolean;
	email?: boolean;
	address?: boolean;
	date?: boolean;
}

/**
 * Parsed `http-equiv` attribute values.
 */
export interface HttpEquivMeta {
	contentType?: string;
	contentLanguage?: string;
	defaultStyle?: string;
	refresh?: HttpEquivRefresh;
	xUaCompatible?: string;
	contentSecurityPolicy?: string;
	contentSecurityPolicyReportOnly?: string;
	setCookie?: string;
	pragma?: string;
	cacheControl?: string;
	expires?: string;
	acceptCh?: string;
	delegateCh?: string;
	permissionsPolicy?: string;
	originTrial?: string;
	originTrialToken: string[];
	xDnsPrefetchControl?: string;
	windowTarget?: string;
	imagetoolbar?: string;
	cleartype?: string;
	permissionsPolicyValue?: string;
}

export interface HttpEquivRefresh {
	raw: string;
	seconds?: number;
	url?: string;
}

/**
 * Open Graph tags including all sub-namespaces (article, book, profile, music, video).
 */
export interface OpenGraphMeta {
	title?: string;
	type?: string;
	url?: string;
	siteName?: string;
	description?: string;
	determiner?: string;
	locale?: string;
	localeAlternate: string[];

	image: string[];
	imageUrl?: string;
	imageSecureUrl?: string;
	imageType?: string;
	imageWidth?: string;
	imageHeight?: string;
	imageAlt?: string;

	video: string[];
	videoUrl?: string;
	videoSecureUrl?: string;
	videoType?: string;
	videoWidth?: string;
	videoHeight?: string;
	videoAlt?: string;

	audio: string[];
	audioUrl?: string;
	audioSecureUrl?: string;
	audioType?: string;

	article?: OgArticleMeta;
	book?: OgBookMeta;
	profile?: OgProfileMeta;
	music?: OgMusicMeta;
	videoNs?: OgVideoNsMeta;
}

export interface OgArticleMeta {
	publishedTime?: string;
	modifiedTime?: string;
	expirationTime?: string;
	author: string[];
	section?: string;
	tag: string[];
	publisher?: string;
}

export interface OgBookMeta {
	author: string[];
	isbn?: string;
	releaseDate?: string;
	tag: string[];
}

export interface OgProfileMeta {
	firstName?: string;
	lastName?: string;
	username?: string;
	gender?: string;
}

export interface OgMusicMeta {
	duration?: string;
	album: string[];
	albumDisc?: string;
	albumTrack?: string;
	musician: string[];
	song: string[];
	songDisc?: string;
	songTrack?: string;
	releaseDate?: string;
	creator: string[];
}

export interface OgVideoNsMeta {
	actor: string[];
	actorRole?: string;
	director: string[];
	writer: string[];
	duration?: string;
	releaseDate?: string;
	tag: string[];
	series?: string;
}

/**
 * Twitter Card tags.
 */
export interface TwitterMeta {
	card?: string;
	site?: string;
	siteId?: string;
	creator?: string;
	creatorId?: string;
	title?: string;
	description?: string;
	image?: string;
	imageSrc?: string;
	imageAlt?: string;
	imageWidth?: string;
	imageHeight?: string;
	url?: string;
	domain?: string;
	player?: string;
	playerWidth?: string;
	playerHeight?: string;
	playerStream?: string;
	playerStreamContentType?: string;
	appNameIphone?: string;
	appIdIphone?: string;
	appUrlIphone?: string;
	appNameIpad?: string;
	appIdIpad?: string;
	appUrlIpad?: string;
	appNameGoogleplay?: string;
	appIdGoogleplay?: string;
	appUrlGoogleplay?: string;
	appCountry?: string;
	label1?: string;
	data1?: string;
	label2?: string;
	data2?: string;
	widgetsCsp?: string;
	widgetsNewEmbedDesign?: string;
	dnt?: string;
}

export interface FbMeta {
	appId?: string;
	admins: string[];
	pages: string[];
}

export interface FediverseMeta {
	creator?: string;
}

export interface AppleMeta {
	mobileWebAppCapable?: boolean | string;
	mobileWebAppStatusBarStyle?: string;
	mobileWebAppTitle?: string;
	touchFullscreen?: boolean | string;
	itunesApp?: string;
	mobileWebAppOrientations?: string;
	touchIconTitle?: string;
	touchStartupImage?: string;
	formatDetectionTelephone?: boolean;
}

export interface MsApplicationMeta {
	tileColor?: string;
	tileImage?: string;
	config?: string;
	configFile?: string;
	navbuttonColor?: string;
	square70x70logo?: string;
	square150x150logo?: string;
	square310x310logo?: string;
	wide310x150logo?: string;
	starturl?: string;
	window?: string;
	task: string[];
	taskSeparator?: string;
	tooltip?: string;
	notification?: string;
	badge?: string;
	tapHighlight?: string;
	allowDomainApiCalls?: string;
	allowDomainMetaTags?: string;
	cleartype?: string;
	smartTagsPreventParsing?: string;
	ieRmOff?: string;
}

export interface VerificationMeta {
	google?: string;
	bing?: string;
	yandex?: string;
	baidu?: string;
	naver?: string;
	pinterest?: string;
	facebook?: string;
	alexa?: string;
	norton?: string;
	ahrefs?: string;
	detectify?: string;
	zoho?: string;
	wot?: string;
	seznam?: string;
	shopify?: string;
	brave?: string;
}

export interface GoogleMeta {
	notranslate?: boolean;
	nositelinkssearchbox?: boolean;
	nopagereadaloud?: boolean;
	translateCustomization?: string;
	adsenseAccount?: string;
	playApp?: string;
	googlebotNotranslate?: boolean;
}

export interface GeoMeta {
	region?: string;
	placename?: string;
	position?: string;
	country?: string;
	a1?: string;
	a2?: string;
	a3?: string;
	lmk?: string;
}

export interface CitationMeta {
	title?: string;
	author: string[];
	authorEmail: string[];
	authorInstitution: string[];
	publicationDate?: string;
	date?: string;
	journalTitle?: string;
	journalAbbrev?: string;
	conferenceTitle?: string;
	publisher?: string;
	volume?: string;
	issue?: string;
	firstpage?: string;
	lastpage?: string;
	doi?: string;
	isbn?: string;
	issn?: string;
	language?: string;
	keywords?: string;
	pdfUrl?: string;
	fulltextHtmlUrl?: string;
	dissertationInstitution?: string;
	technicalReportInstitution?: string;
	technicalReportNumber?: string;
}

export interface RdfaMeta {
	prefix?: string;
	vocab?: string;
	typeOf?: string;
}

export interface MicrodataMeta {
	itemscope?: boolean;
	itemtype?: string;
}

export interface AmpMeta {
	enabled?: boolean;
	lightning?: boolean;
	canonicalFromAmp?: string;
	amphtml?: string;
	experimentsOptIn?: string;
	runtimeScript?: boolean;
}

export interface LegacyMeta {
	msSmartTagsPreventParsing?: string;
	imagetoolbar?: string;
	pageVersion?: string;
	audience?: string;
	resourceType?: string;
	distribution?: string;
	docClass?: string;
	docRights?: string;
	docType?: string;
	mobileOptimized?: string;
	handheldFriendly?: string;
}

export interface MobileMeta {
	handheldFriendly?: string;
	mobileOptimized?: string;
	mobileAgent?: string;
	fullScreen?: string;
	browsermode?: string;
	x5Orientation?: string;
	x5Fullscreen?: string;
	x5PageMode?: string;
	screenOrientation?: string;
	layoutmode?: string;
	imagemode?: string;
}

export interface MicroformatsMeta {
	relMe: string[];
}

export interface PinterestMeta {
	richPin?: boolean;
	nopin?: boolean;
	disableRichPin?: boolean;
}

export interface SlackMeta {
	ogImageWidth?: string;
}

export interface LinkedInMeta {
	ogType?: string;
}

export interface ExperimentalMeta {
	darkreaderLock?: boolean;
	turboCacheControl?: string;
	turboVisitControl?: string;
	viewTransition?: string;
}

export interface WikiMeta {
	resourceLoaderDynamicStyles?: string;
	mediawikiGenerator?: string;
}

/**
 * Parsed `<link>` elements grouped by `rel`. Single-rel entries are stored on
 * named fields; multi-rel and unknown rels are stored on `others.link[]`.
 */
export interface LinkMeta {
	canonical?: string;
	alternateHreflang: LinkEntry[];
	alternateMedia: LinkEntry[];
	alternateRss: LinkEntry[];
	alternateAtom: LinkEntry[];
	alternateJsonFeed: LinkEntry[];
	oembedJson?: LinkEntry;
	oembedXml?: LinkEntry;
	alternateActivityJson?: LinkEntry;
	amphtml?: string;
	author?: string;
	bookmark?: string;
	help?: string;
	license?: string;
	next?: string;
	prev?: string;
	previous?: string;
	first?: string;
	last?: string;
	up?: string;
	index?: string;
	contents?: string;
	start?: string;
	search?: LinkEntry;
	tag: LinkEntry[];
	archives: LinkEntry[];
	publisher?: string;
	privacyPolicy?: string;
	termsOfService?: string;
	copyright?: string;
	appendix: LinkEntry[];
	chapter: LinkEntry[];
	section: LinkEntry[];
	subsection: LinkEntry[];
	glossary?: string;
	profile: LinkEntry[];
	editUri?: string;
	pingback?: string;
	webmention?: string;
	micropub?: string;
	microsub?: string;
	me: LinkEntry[];
	authorizationEndpoint?: string;
	tokenEndpoint?: string;
	indieauthMetadata?: string;
	openidServer?: string;
	openidDelegate?: string;
	openid2Provider?: string;
	openid2LocalId?: string;
	hub?: string;
	self?: string;
	payment?: string;
	enclosure: LinkEntry[];
	external: LinkEntry[];
	nofollow: LinkEntry[];
	sponsored: LinkEntry[];
	ugc: LinkEntry[];
	noopener: LinkEntry[];
	noreferrer: LinkEntry[];
	opener: LinkEntry[];
	imageSrc?: string;
	shortlink?: string;
	dnsPrefetch: LinkEntry[];
	preconnect: LinkEntry[];
	prefetch: LinkEntry[];
	prerender: LinkEntry[];
	preload: LinkEntry[];
	modulepreload: LinkEntry[];
	expect: LinkEntry[];
	stylesheet: LinkEntry[];
	manifest?: string;
	serviceworker?: string;
	dpp?: string;
	gbfs?: string;
	syndication: LinkEntry[];
	apiCatalog?: string;
	memento?: string;
	timegate?: string;
	timemap?: string;
	versionHistory?: string;
	latestVersion?: string;
	predecessorVersion?: string;
	successorVersion?: string;
	workingCopy?: string;
	workingCopyOf?: string;
	describedby?: string;
	describes?: string;
	via?: string;
	related: LinkEntry[];
	citeAs?: string;
	disclosure?: string;
	status?: string;
	sunset?: string;
	deprecation?: string;
	lrdd?: string;
	hosts?: string;
	service?: string;
	serviceDesc?: string;
	serviceDoc?: string;
	serviceMeta?: string;
	c2paManifest?: string;
	compressionDictionary?: string;

	icon?: LinkEntry;
	iconAny?: LinkEntry;
	iconSvg?: LinkEntry;
	iconSized: LinkEntry[];
	shortcutIcon?: string;
	appleTouchIcon?: LinkEntry;
	appleTouchIconSized: LinkEntry[];
	appleTouchIconPrecomposed: LinkEntry[];
	appleTouchStartupImage: LinkEntry[];
	appleTouchStartupImageIphone?: LinkEntry;
	appleTouchStartupImageIpadPortrait?: LinkEntry;
	appleTouchStartupImageIpadLandscape?: LinkEntry;
	maskIcon?: LinkEntry;
	fluidIcon?: LinkEntry;

	securityTxt?: string;
}

/**
 * Common shape of a parsed `<link>` element.
 */
export interface LinkEntry {
	href: string;
	rel: readonly string[];
	type?: string;
	media?: string;
	sizes?: string;
	title?: string;
	hreflang?: string;
	as?: string;
	crossorigin?: string;
	color?: string;
	blocking?: string;
	imagesrcset?: string;
}

/**
 * A `<script type="application/ld+json">` or `<script type="speculationrules">`
 * entry. `parsed` holds the result of `JSON.parse(raw)`; on parse failure
 * `parseError` is set and `parsed` is `undefined`.
 */
export interface JsonLdEntry {
	raw: string;
	parsed?: unknown;
	parseError?: string;
}

/**
 * Catch-all bucket for markup not covered by typed fields above. Always present
 * (empty values when no unknowns were found) so consumers can iterate without
 * null-checking.
 */
export interface OthersBucket {
	/** Unknown `<meta name>` → list of `content` values. */
	meta: Record<string, string[]>;
	/** Unknown `<meta property>` → list of `content` values. */
	property: Record<string, string[]>;
	/** Unknown `<meta http-equiv>` → list of `content` values. */
	httpEquiv: Record<string, string[]>;
	/** Unknown `<meta itemprop>` → list of `content` values. */
	itemprop: Record<string, string[]>;
	/** `<link>` elements whose every `rel` is unknown. */
	link: LinkEntry[];
	/** `<script>` elements with unknown `type` (kept for raw inspection). */
	script: ScriptEntry[];
	/** `<iframe>` elements (used to capture GTM noscript iframes, etc.). */
	iframe: IframeEntry[];
}

export interface ScriptEntry {
	type: string;
	content?: string;
	src?: string;
	location: 'head' | 'body' | 'noscript';
}

export interface IframeEntry {
	src: string;
	location: 'head' | 'body' | 'noscript';
}

/**
 * Detected third-party tags from the page (analytics, frameworks, libraries,
 * etc.). Produced by `tag-detection.ts` by combining `simple-wappalyzer`
 * results with ID extractors.
 */
export interface TagsMeta {
	/** Wappalyzer category name → provider name → detection detail. */
	detected: Record<string, Record<string, TagDetail>>;
	/** Flat list of all detected entries (one per (provider, id) tuple). */
	entries: TagEntry[];
}

export interface TagDetail {
	/** Real IDs extracted from the page (e.g., `G-XXXX`, `GTM-XXXX`). */
	ids: string[];
	/** Wappalyzer-reported version, if available. */
	version?: string;
	/** Wappalyzer-reported confidence (0-100), if available. */
	confidence?: number;
}

export interface TagEntry {
	provider: string;
	categories: readonly string[];
	id?: string;
	version?: string;
	confidence?: number;
	sources: readonly TagSource[];
}

export interface TagSource {
	type:
		| 'script-src'
		| 'inline'
		| 'iframe-src'
		| 'window-global'
		| 'img-src'
		| 'header'
		| 'meta'
		| 'html';
	src?: string;
	location?: 'head' | 'body' | 'noscript';
	globalName?: string;
}

/**
 * Discriminated union of raw entries collected from the page by `collectHead`.
 * Used as the input shape for `classify()`. Keeping this serializable lets us
 * collect on the browser side and process on the Node side.
 */
export type RawHeadEntry =
	| {
			kind: 'html';
			lang?: string;
			dir?: string;
			xmlns?: string;
			prefix?: string;
			vocab?: string;
			typeOf?: string;
			itemscope?: boolean;
			itemtype?: string;
			amp?: boolean;
			lightning?: boolean;
	  }
	| { kind: 'title'; content: string }
	| { kind: 'base'; href?: string; target?: string }
	| {
			kind: 'meta';
			name?: string;
			property?: string;
			httpEquiv?: string;
			itemprop?: string;
			charset?: string;
			content?: string;
			media?: string;
	  }
	| {
			kind: 'link';
			rel: readonly string[];
			href: string;
			type?: string;
			media?: string;
			sizes?: string;
			title?: string;
			hreflang?: string;
			as?: string;
			crossorigin?: string;
			color?: string;
			blocking?: string;
			imagesrcset?: string;
	  }
	| {
			kind: 'script';
			scriptType: string;
			content?: string;
			src?: string;
			location: 'head' | 'body' | 'noscript';
	  }
	| { kind: 'iframe'; src: string; location: 'head' | 'body' | 'noscript' }
	| { kind: 'window-global'; names: readonly string[] };
