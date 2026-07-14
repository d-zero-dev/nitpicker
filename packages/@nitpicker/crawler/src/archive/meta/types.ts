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
 * One row in the `page_jsonld` table.
 *
 * Captures both `<script type="application/ld+json">` (`kind = 'ld+json'`) and
 * `<script type="speculationrules">` (`kind = 'speculationrules'`) entries.
 * @see extract-tags-for-archive.ts (sibling for tags) and the table definition
 * in `archive/init-schema.ts`.
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
 */
export type JsonLdRowForInsert = Omit<JsonLdRow, 'id'>;

/**
 * One row in the `page_tags` table.
 *
 * Each row represents one detected Wappalyzer provider × external-id tuple for
 * one page. A page typically has 1–10 rows.
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
 */
export type TagRowForInsert = Omit<TagRow, 'id'>;

/**
 * Summary of one page's JSON-LD entries returned by `get-page-detail`.
 *
 * Keeps the response token-bounded for MCP / LLM consumers; the full `raw`
 * payload is fetched separately via `get-page-jsonld(url)`.
 * @see summarize-jsonld.ts
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
 * Summary of one page's Wappalyzer tags returned by `get-page-detail`.
 * @see summarize-tags.ts
 */
export interface TagsSummary {
	/** Total tag rows for the page. */
	count: number;
	/** Provider → list of external IDs (unique, sorted). Providers with no IDs map to `[]`. */
	providerIds: Readonly<Record<string, readonly string[]>>;
}

/**
 * One row of {@link import('@d-zero/beholder').Meta.tags.detected} after
 * archive-side flattening.
 *
 * Used by `get-tag-inventory` to return per-provider page counts across the
 * whole site.
 */
export interface TagInventoryEntry {
	/** Wappalyzer provider name. */
	provider: string;
	/** Number of distinct pages where the provider was detected. */
	pageCount: number;
}

/**
 * Error thrown by `assert-compatible-version` when the archive's
 * `info.version` is older than the format version this build accepts.
 *
 * Catch this at CLI / viewer boundaries to print a friendly message; do not
 * confuse with generic `Error` thrown by `Database.connect` (lockfile / I/O).
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
