/** Combinator joining two adjacent compounds of a complex selector. */
export type Combinator = 'descendant' | 'child';

/** Attribute selector operators the engine evaluates. */
export type AttributeOperator =
	'exists' | 'equals' | 'includes' | 'dash' | 'prefix' | 'suffix' | 'substring';

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
