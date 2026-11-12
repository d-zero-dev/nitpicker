/**
 * Types of the stored-HTML matcher, defined here so `@nitpicker/query` and
 * the CLI never depend on `@nitpicker/core`'s own types. Each is structurally
 * identical to its counterpart in core; the wrappers in this directory pass
 * values across, so a drift fails to compile there.
 */

/** How two adjacent compounds of a complex selector are joined. */
export type SelectorCombinator = 'descendant' | 'child';

/** The attribute selector operators the matcher evaluates. */
export type SelectorAttributeOperator =
	| 'exists'
	| 'equals'
	| 'includes'
	| 'dash'
	| 'prefix'
	| 'suffix'
	| 'substring';

/** One attribute condition of a compound (`[a]`, `[a^=v]`, `.cls`, `#id`, ...). */
export interface SelectorAttributeTest {
	/** Lower-cased attribute name. */
	readonly name: string;
	readonly operator: SelectorAttributeOperator;
	/** The selector's literal value (empty for `exists`). */
	readonly value: string;
	/** Whether values compare ignoring ASCII case. */
	readonly ignoreCase: boolean;
}

/** An `An+B` position test (`:nth-child`, `:nth-of-type`, `:first-*`). */
export interface SelectorNthTest {
	readonly kind: 'child' | 'of-type';
	readonly a: number;
	readonly b: number;
}

/** The compound inside `:not(...)` — a compound without negations of its own. */
export interface SelectorNegatedCompound {
	/** Lower-cased tag name, or `null` for any element. */
	readonly tag: string | null;
	readonly attributes: readonly SelectorAttributeTest[];
	readonly nth: readonly SelectorNthTest[];
}

/** A compound selector: every condition must hold on one element. */
export interface SelectorCompound extends SelectorNegatedCompound {
	readonly negations: readonly SelectorNegatedCompound[];
}

/** One comma alternative of a selector list. */
export interface SelectorAlternative {
	/** Compounds in source (ancestor-first) order; between 1 and 30. */
	readonly compounds: readonly SelectorCompound[];
	/** `combinators[j - 1]` joins `compounds[j - 1]` and `compounds[j]`. */
	readonly combinators: readonly SelectorCombinator[];
	/**
	 * Lower-cased printable-ASCII literals that must occur in the document in
	 * this order for the alternative to match, or `null` when none can be derived.
	 */
	readonly prefilterLiterals: readonly string[] | null;
	/**
	 * Whether one start tag decides this alternative: a single compound with
	 * no position test whose attribute values have a single stored form.
	 */
	readonly direct: boolean;
}

/** A validated selector list as the matcher evaluates it. */
export interface SelectorPlan {
	readonly alternatives: readonly SelectorAlternative[];
	/** Whether any alternative tests `:nth-child` / `:first-child`. */
	readonly needsChildIndex: boolean;
	/** Whether any alternative tests `:nth-of-type` / `:first-of-type`. */
	readonly needsTypeIndex: boolean;
}

/** The verdict on one document and which stages produced it. */
export interface HtmlMatchOutcome {
	/** Whether an element of the document matches the selector list. */
	readonly matched: boolean;
	/** The ordered-literal prefilter rejected the document; its markup was never read. */
	readonly prefiltered: boolean;
	/** The open-element stack ran over the document. */
	readonly tokenized: boolean;
	/** Elements the stack tested (zero when it did not run). */
	readonly elementsVisited: number;
}

/** One stored HTML snapshot as it sits in `page_html_blobs`. */
export interface StoredHtmlSnapshot {
	/** The stored bytes. */
	readonly body: Uint8Array;
	/** `page_html_blobs.codec`: `zstd` or `none`; anything else is rejected. */
	readonly codec: string;
}

/**
 * What `query search-html` looks for: a literal substring or a regular
 * expression (Rust `regex` syntax) with its flags.
 */
export interface SearchPattern {
	/** The literal text, or the regular expression's source. */
	readonly source: string;
	/** Match `source` as plain text; the flags are then ignored. */
	readonly literal: boolean;
	/** `i`. */
	readonly ignoreCase: boolean;
	/** `m`: `^` and `$` match at every `\n`. */
	readonly multiLine: boolean;
	/** `s`: `.` matches `\n` too. */
	readonly dotAll: boolean;
}

/** What a search found in one document. */
export interface SnapshotSearchOutcome {
	/** Non-overlapping matches; 0 when the document does not match. */
	readonly matchCount: number;
	/** Whitespace-collapsed window around the first match; empty when there is none. */
	readonly snippet: string;
}

/** The verdict on one snapshot of a batch. */
export interface SnapshotMatchOutcome {
	readonly matched: boolean;
	/** The ordered-literal prefilter rejected the document; its markup was never read. */
	readonly prefiltered: boolean;
	/** The open-element stack ran over the document. */
	readonly tokenized: boolean;
}
