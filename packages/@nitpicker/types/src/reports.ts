/**
 * A single violation found by an analyze plugin (e.g. accessibility, markup, text).
 *
 * Each violation is associated with a specific page URL and includes enough
 * context for the reporter to group and display results.
 */
export interface Violation {
	/** Name of the validator that produced this violation (e.g. `"axe-core"`, `"markuplint"`). */
	validator: string;
	/** Severity level as defined by the validator (e.g. `"error"`, `"warning"`, `"info"`). */
	severity: string;
	/** Rule identifier within the validator's ruleset (e.g. `"color-contrast"`, `"no-hard-coded-color"`). */
	rule: string;
	/** Source code snippet or element selector where the violation occurred. */
	code: string;
	/** Human-readable description of the violation. */
	message: string;
	/** Page URL where the violation was detected. */
	url: string;
	/** Raw violation object from the underlying tool, preserved for debugging. */
	_raw?: unknown;
}

/**
 * A pair of items showing a discrepancy found across pages in the report.
 * Used by plugins that detect inconsistencies across pages
 * (e.g. different meta descriptions for the same canonical URL).
 */
export interface Discrepancy {
	/** Left item's display value. */
	left: string;
	/** Optional annotation for the left item. */
	leftNote?: string;
	/** URL where the left item was found. */
	leftSourceUrl: string;
	/** Optional annotation for the left item's source URL. */
	leftSourceUrlNote?: string;
	/** Right item's display value. */
	right: string;
	/** Optional annotation for the right item. */
	rightNote?: string;
	/** URL where the right item was found. */
	rightSourceUrl: string;
	/** Optional annotation for the right item's source URL. */
	rightSourceUrlNote?: string;
	/** General note for this discrepancy entry. */
	note?: string;
}

/**
 * Output produced by a single analyze plugin for a single run.
 *
 * A plugin may return any combination of `pageData`, `violations`,
 * `discrepancies`, and `summary` depending on its nature.
 * @see {@link ../../core/src/types.ts} for the `Plugin` interface that produces this
 */
export interface Report {
	/** Plugin display name shown in report headers. */
	name: string;
	/**
	 * Per-page tabular data. Keys of the `data` record are page URLs.
	 * Used for metrics that are best displayed in a spreadsheet-like format.
	 */
	pageData?: DataTable<string>;
	/** List of violations found across all pages. */
	violations?: Violation[];
	/** List of cross-page discrepancies. */
	discrepancies?: Discrepancy[];
	/** Aggregate summary (e.g. total score, pass rate). */
	summary?: {
		/** Summary title (e.g. `"Accessibility Score"`). */
		title: string;
		/** Top-level summary value. */
		value?: string;
		/** Breakdown details under the summary. */
		details?: {
			/** Detail label. */
			title: string;
			/** Detail value. */
			value: string;
		}[];
	};
}

/**
 * Generic tabular data structure used by analyze plugins.
 * @template K - String literal union of column keys
 * @template H - Header record type mapping column keys to display names
 * @example
 * ```ts
 * const table: DataTable<'title' | 'score'> = {
 *   headers: { title: 'Page Title', score: 'Score' },
 *   data: {
 *     'https://example.com/': {
 *       title: { value: 'Home' },
 *       score: { value: 95 },
 *     },
 *   },
 * };
 * ```
 */
export type DataTable<K extends string, H = Record<K, string>> = {
	/** Column header labels keyed by column identifier. */
	headers: H;
	/**
	 * Row data keyed by page URL.
	 * Each row contains a value for every column defined in `headers`.
	 */
	data: Record<string, { [P in keyof H]: TableValue }>;
	/**
	 * Optional per-cell metadata (e.g. formatting hints, conditional styles).
	 * Outer key is page URL, inner keys match `headers`.
	 */
	options?: Record<
		string,
		{ [P in keyof H]: Record<string, string | number | boolean | null> }
	>;
};

/**
 * A single cell value in a {@link DataTable}.
 */
export interface TableValue {
	/** The cell's display value. `null` represents an empty cell. */
	value: string | number | boolean | null;
	/** Optional tooltip or annotation shown alongside the value. */
	note?: string;
}
