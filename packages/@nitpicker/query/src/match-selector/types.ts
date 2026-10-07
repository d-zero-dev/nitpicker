/** Combinator joining two adjacent compounds of a complex selector. */
export type Combinator = 'descendant' | 'child';

/** Attribute selector operators the engine evaluates. */
export type AttributeOperator =
	| 'exists'
	| 'equals'
	| 'includes'
	| 'dash'
	| 'prefix'
	| 'suffix'
	| 'substring';

/** One attribute condition of a compound (`[a]`, `[a^=v]`, `.cls`, `#id`, ...). */
export interface AttributeTest {
	/** Lower-cased attribute name. */
	readonly name: string;
	readonly operator: AttributeOperator;
	/** The selector's literal value (empty for `exists`). */
	readonly value: string;
	/**
	 * Whether values compare ignoring ASCII case: an explicit `i` flag, or one of
	 * the attributes HTML defines as case-insensitive unless the selector says `s`.
	 */
	readonly ignoreCase: boolean;
}

/** An `An+B` position test (`:nth-child`, `:nth-of-type`, `:first-*`). */
export interface NthTest {
	readonly kind: 'child' | 'of-type';
	readonly a: number;
	readonly b: number;
}

/** The compound inside `:not(...)` — a compound without negations of its own. */
export interface NegatedCompound {
	/** Lower-cased tag name, or `null` for any element. */
	readonly tag: string | null;
	readonly attributes: readonly AttributeTest[];
	readonly nth: readonly NthTest[];
}

/** A compound selector: every condition must hold on one element. */
export interface CompoundMatcher extends NegatedCompound {
	readonly negations: readonly NegatedCompound[];
}

/**
 * Compounds joined by combinators, in source (ancestor-first) order.
 * `combinators[j - 1]` joins `compounds[j - 1]` and `compounds[j]`.
 */
export interface ComplexSelector {
	readonly compounds: readonly CompoundMatcher[];
	readonly combinators: readonly Combinator[];
}

/** A validated selector list: one {@link ComplexSelector} per comma alternative. */
export interface CompiledSelector {
	readonly source: string;
	readonly alternatives: readonly ComplexSelector[];
}

/** A comma alternative with the literals its necessary-condition prefilter looks for. */
export interface PlannedAlternative {
	readonly selector: ComplexSelector;
	/** Lower-cased literals in ancestor-first order, or `null` when none can be derived. */
	readonly prefilterLiterals: readonly string[] | null;
}

/** How a selector list is split across the matching stages. */
export interface SelectorMatchPlan {
	/**
	 * One regular expression covering every alternative that is a single
	 * compound decidable from one start tag; `null` when there is none.
	 */
	readonly directRegExp: RegExp | null;
	/**
	 * Per alternative covered by `directRegExp`, the literals it needs
	 * (`null` when none can be derived). A document that lacks them cannot
	 * match that alternative, so the scan can be skipped.
	 */
	readonly directPrefilterLiterals: readonly (readonly string[] | null)[];
	/** Alternatives that need the open-element stack. */
	readonly tokenizedAlternatives: readonly PlannedAlternative[];
	/** Every alternative, used when the direct scan has to hand the whole document over. */
	readonly allAlternatives: readonly PlannedAlternative[];
	/** Whether any alternative tests `:nth-child` / `:first-child`. */
	readonly needsChildIndex: boolean;
	/** Whether any alternative tests `:nth-of-type` / `:first-of-type`. */
	readonly needsTypeIndex: boolean;
}

/** Result of the direct (single start tag) scan of one document. */
export type DirectMatchOutcome = 'matched' | 'unmatched' | 'needs-tokenizer';

/** A start or end tag read from the stored markup. */
export type TagEvent =
	| {
			readonly kind: 'open';
			/** Lower-cased tag name. */
			readonly name: string;
			/** Everything between the tag name and the closing `>`. */
			readonly attrSource: string;
			/** `true` when the element has no children in the tree (void, `/>`, raw text). */
			readonly leaf: boolean;
	  }
	| { readonly kind: 'close'; readonly name: string };

/** The element a compound is tested against. Reused across elements. */
export interface ElementContext {
	name: string;
	attrSource: string;
	/** Parsed lazily from `attrSource`; `null` until a test needs it. */
	attributes: Map<string, string> | null;
	/** 1-based position among sibling elements. */
	childIndex: number;
	/** 1-based position among sibling elements of the same name. */
	typeIndex: number;
}

/** Outcome of matching one document. */
export interface HtmlMatchOutcome {
	readonly matched: boolean;
	/** `true` when the ordered-literal prefilter rejected the document and its markup was never scanned. */
	readonly prefiltered: boolean;
	/** `true` when the open-element stack ran over the document. */
	readonly tokenized: boolean;
	/** Elements the stack evaluated (early exit keeps this small). */
	readonly elementsVisited: number;
}
