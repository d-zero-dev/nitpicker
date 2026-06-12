import type { ListPagesOptions } from '@nitpicker/query';

/** Page-list filter state (everything except pagination, which the hook owns). */
export type PagesFilter = Omit<ListPagesOptions, 'limit' | 'offset'>;

/**
 * Analysis violation entry, mirroring the API response shape.
 *
 * Defined here because `@nitpicker/query` keeps `ViolationEntry` internal
 * (not exported from its public surface).
 */
export interface ViolationEntry {
	/** The page URL. */
	url: string;
	/** The validator that produced this violation (axe, markuplint, etc.). */
	validator: string;
	/** The severity level. */
	severity: string;
	/** The rule ID. */
	rule: string;
	/** The violation message. */
	message: string;
	/** The source code snippet or element selector. */
	code: string;
}

/**
 * Result of querying which pages reference a resource.
 *
 * Mirrors the API response (`@nitpicker/query` keeps this type internal).
 */
export interface ResourceReferrerResult {
	/** The queried resource URL. */
	resourceUrl: string;
	/** URLs of pages referencing the resource. */
	pageUrls: string[];
	/** Total number of referring pages. */
	total: number;
}

/** Result of fetching a stored HTML snapshot. */
export interface PageHtmlResult {
	/** The (possibly truncated) HTML source. */
	html: string;
	/** Whether the HTML was truncated to the requested max length. */
	truncated: boolean;
}

/** A navigation entry in the sidebar. */
export interface NavItem {
	/** The client route path. */
	path: string;
	/** The i18n key for the display label (under `nav.`). */
	labelKey: string;
}

/** Supported UI locales. */
export type Locale = 'en' | 'ja';

/** The i18n context value: current locale, a setter, and the translate function. */
export interface I18nValue {
	/** The active locale. */
	locale: Locale;
	/** Switches the active locale. */
	setLocale: (locale: Locale) => void;
	/**
	 * Translates a dot-separated key (e.g. `views.pages.title`) for the active
	 * locale. Returns the key itself if no translation is found. Occurrences of
	 * `{name}` in the value are replaced with `params.name`.
	 */
	t: (key: string, params?: Record<string, string | number>) => string;
}

/** One segment of a text diff. */
export interface DiffSegment {
	/** The text of this segment. */
	value: string;
	/** Whether the segment is unchanged, removed (actual-only), or added (expected-only). */
	type: 'common' | 'removed' | 'added';
}

/** A character-level diff between two strings, split per side. */
export interface DiffResult {
	/** Segments for the actual value (with `removed` middle). */
	actual: DiffSegment[];
	/** Segments for the expected value (with `added` middle). */
	expected: DiffSegment[];
}
