/**
 * Shared type definitions for archive-side meta processing helpers under {@link ./}.
 *
 * Mirrors the shape of {@link import('@d-zero/beholder').Meta} after archive-side
 * derivation: flat columns persisted to the `pages` table, denormalised
 * aggregates, per-row shapes for `page_jsonld` / `page_tags`, and the summary
 * objects returned by `get-page-detail` consumers.
 * @module
 */

import { compareSemver } from './compare-semver.js';

/**
 * Flat columns of the `pages` table derived from {@link import('@d-zero/beholder').Meta}.
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
