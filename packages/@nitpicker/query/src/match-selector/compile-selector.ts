import type {
	AttributeOperator,
	AttributeTest,
	Combinator,
	CompiledSelector,
	CompoundMatcher,
	ComplexSelector,
	NegatedCompound,
	NthTest,
} from './types.js';
import type { AttributeSelector, PseudoSelector, Selector } from 'css-what';

import { AttributeAction, parse, SelectorType } from 'css-what';

import { CASE_INSENSITIVE_ATTRIBUTE_NAMES } from './case-insensitive-attribute-names.js';
import { parseAnPlusB } from './parse-an-plus-b.js';
import { UnsupportedSelectorError } from './unsupported-selector-error.js';

/** Bits of a 32-bit state set, minus the sign bit and one spare. */
const MAX_COMPOUNDS_PER_ALTERNATIVE = 30;
const MAX_ALTERNATIVES = 64;

const ATTRIBUTE_OPERATORS: Readonly<
	Record<AttributeAction, AttributeOperator | undefined>
> = {
	[AttributeAction.Exists]: 'exists',
	[AttributeAction.Equals]: 'equals',
	[AttributeAction.Element]: 'includes',
	[AttributeAction.Hyphen]: 'dash',
	[AttributeAction.Start]: 'prefix',
	[AttributeAction.End]: 'suffix',
	[AttributeAction.Any]: 'substring',
	[AttributeAction.Not]: undefined,
};

/** Pseudo-classes that need to see siblings or descendants that come later. */
const NEEDS_LOOKAHEAD = new Set([
	'last-child',
	'only-child',
	'last-of-type',
	'only-of-type',
	'nth-last-child',
	'nth-last-of-type',
	'has',
]);

const REJECTED_COMBINATORS: Readonly<Record<string, string>> = {
	[SelectorType.Adjacent]: 'adjacent sibling combinator (+) needs the next sibling',
	[SelectorType.Sibling]: 'general sibling combinator (~) needs later siblings',
	[SelectorType.Parent]: 'parent combinator is not standard CSS',
	[SelectorType.ColumnCombinator]: 'column combinator (||) is not supported',
};

/**
 * Compiles an attribute selector token (which is also how css-what
 * represents `.class` and `#id`), rejecting namespaces and `[a!=b]`.
 * @param token - The attribute token.
 * @param selector - The selector as the caller wrote it, for error messages.
 * @returns The attribute condition. Values ignore ASCII case with an `i` flag, and
 *   by default for the attributes HTML defines as case-insensitive (`type`, `rel`,
 *   `lang`, ...) unless the selector says `s`.
 */
function compileAttribute(token: AttributeSelector, selector: string): AttributeTest {
	if (token.namespace !== null) {
		throw new UnsupportedSelectorError(selector, 'namespaced attribute selectors');
	}
	const operator = ATTRIBUTE_OPERATORS[token.action];
	if (operator === undefined) {
		throw new UnsupportedSelectorError(selector, 'the [attr!=value] operator');
	}
	const name = token.name.toLowerCase();
	// An explicit `s` flag (`false`) keeps the comparison case-sensitive.
	const ignoreCase =
		token.ignoreCase === true ||
		(token.ignoreCase !== false && CASE_INSENSITIVE_ATTRIBUTE_NAMES.has(name));
	return {
		name,
		operator,
		value: operator === 'exists' ? '' : token.value,
		ignoreCase,
	};
}

/**
 * Compiles `:nth-child()` / `:nth-of-type()`, rejecting the `of S` form
 * and unparsable arguments.
 * @param options - The token and its context.
 * @param options.token - The pseudo-class token.
 * @param options.kind - Which sibling position the argument counts.
 * @param options.selector - The selector as the caller wrote it, for error messages.
 * @returns The `An+B` position test.
 */
function compileNth(options: {
	token: PseudoSelector;
	kind: NthTest['kind'];
	selector: string;
}): NthTest {
	const { token, kind, selector } = options;
	if (typeof token.data !== 'string') {
		throw new UnsupportedSelectorError(
			selector,
			`:${token.name}() needs an An+B argument`,
		);
	}
	if (/\sof\s/i.test(token.data)) {
		throw new UnsupportedSelectorError(
			selector,
			`:${token.name}() with "of S" needs a filtered sibling count`,
		);
	}
	try {
		return { kind, ...parseAnPlusB(token.data) };
	} catch (error) {
		throw new UnsupportedSelectorError(selector, `invalid :${token.name}() argument`, {
			cause: error,
		});
	}
}

/**
 * Compiles the tokens of one compound selector (everything between two
 * combinators).
 * @param options - The tokens and their context.
 * @param options.tokens - The compound's tokens, in source order.
 * @param options.selector - The selector as the caller wrote it, for error messages.
 * @param options.allowNot - `false` inside `:not()`, where a nested `:not()` is rejected.
 * @returns The compound with its tag, attribute, position and negation conditions.
 */
function compileCompound(options: {
	tokens: readonly Selector[];
	selector: string;
	allowNot: boolean;
}): CompoundMatcher {
	const { tokens, selector, allowNot } = options;
	let tag: string | null = null;
	const attributes: AttributeTest[] = [];
	const nth: NthTest[] = [];
	const negations: NegatedCompound[] = [];
	for (const token of tokens) {
		switch (token.type) {
			case SelectorType.Tag: {
				if (token.namespace !== null) {
					throw new UnsupportedSelectorError(selector, 'namespaced type selectors');
				}
				tag = token.name.toLowerCase();
				break;
			}
			case SelectorType.Universal: {
				if (token.namespace !== null) {
					throw new UnsupportedSelectorError(selector, 'namespaced universal selectors');
				}
				break;
			}
			case SelectorType.Attribute: {
				attributes.push(compileAttribute(token, selector));
				break;
			}
			case SelectorType.PseudoElement: {
				throw new UnsupportedSelectorError(
					selector,
					`pseudo-element ::${token.name} matches no element`,
				);
			}
			case SelectorType.Pseudo: {
				const name = token.name.toLowerCase();
				switch (name) {
					case 'first-child': {
						nth.push({ kind: 'child', a: 0, b: 1 });

						break;
					}
					case 'first-of-type': {
						nth.push({ kind: 'of-type', a: 0, b: 1 });

						break;
					}
					case 'nth-child': {
						nth.push(compileNth({ token, kind: 'child', selector }));

						break;
					}
					case 'nth-of-type': {
						nth.push(compileNth({ token, kind: 'of-type', selector }));

						break;
					}
					case 'not': {
						negations.push(compileNegation({ token, selector, allowNot }));

						break;
					}
					default: {
						if (NEEDS_LOOKAHEAD.has(name)) {
							throw new UnsupportedSelectorError(
								selector,
								`:${name} needs markup that comes after the element`,
							);
						} else {
							throw new UnsupportedSelectorError(selector, `pseudo-class :${name}`);
						}
					}
				}
				break;
			}
			default: {
				throw new UnsupportedSelectorError(selector, 'unexpected combinator');
			}
		}
	}
	return { tag, attributes, nth, negations };
}

/**
 * Compiles `:not(<compound>)`. Only one compound without combinators or
 * nested negation is accepted, so the negation can be decided on the same
 * element as the compound it belongs to.
 * @param options - The token and its context.
 * @param options.token - The `:not` pseudo-class token.
 * @param options.selector - The selector as the caller wrote it, for error messages.
 * @param options.allowNot - Whether a negation is allowed here (it is not inside another one).
 * @returns The negated compound.
 */
function compileNegation(options: {
	token: PseudoSelector;
	selector: string;
	allowNot: boolean;
}): NegatedCompound {
	const { token, selector, allowNot } = options;
	if (!allowNot) {
		throw new UnsupportedSelectorError(selector, 'nested :not()');
	}
	if (!Array.isArray(token.data) || token.data.length !== 1) {
		throw new UnsupportedSelectorError(selector, ':not() with a selector list');
	}
	const inner = token.data[0]!;
	if (
		inner.some(
			(innerToken) =>
				innerToken.type !== SelectorType.Tag &&
				innerToken.type !== SelectorType.Universal &&
				innerToken.type !== SelectorType.Attribute &&
				innerToken.type !== SelectorType.Pseudo &&
				innerToken.type !== SelectorType.PseudoElement,
		)
	) {
		throw new UnsupportedSelectorError(selector, ':not() with a combinator');
	}
	const { tag, attributes, nth } = compileCompound({
		tokens: inner,
		selector,
		allowNot: false,
	});
	return { tag, attributes, nth };
}

/**
 * Splits one comma alternative at its combinators and compiles each
 * compound, rejecting combinators other than descendant and child.
 * @param tokens - The alternative's tokens, in source order.
 * @param selector - The selector as the caller wrote it, for error messages.
 * @returns The compounds with the combinators between them.
 */
function compileComplex(tokens: readonly Selector[], selector: string): ComplexSelector {
	const compounds: CompoundMatcher[] = [];
	const combinators: Combinator[] = [];
	let current: Selector[] = [];
	for (const token of tokens) {
		if (token.type === SelectorType.Child || token.type === SelectorType.Descendant) {
			if (current.length === 0) {
				throw new UnsupportedSelectorError(selector, 'a combinator without a selector');
			}
			compounds.push(compileCompound({ tokens: current, selector, allowNot: true }));
			combinators.push(token.type === SelectorType.Child ? 'child' : 'descendant');
			current = [];
		} else if (token.type in REJECTED_COMBINATORS) {
			throw new UnsupportedSelectorError(selector, REJECTED_COMBINATORS[token.type]!);
		} else {
			current.push(token);
		}
	}
	if (current.length === 0) {
		throw new UnsupportedSelectorError(selector, 'a combinator without a selector');
	}
	compounds.push(compileCompound({ tokens: current, selector, allowNot: true }));
	if (compounds.length > MAX_COMPOUNDS_PER_ALTERNATIVE) {
		throw new UnsupportedSelectorError(
			selector,
			`more than ${MAX_COMPOUNDS_PER_ALTERNATIVE} compound selectors in one chain`,
		);
	}
	return { compounds, combinators };
}

/**
 * Parses a CSS selector list and validates it against the grammar that a
 * single pass over stored markup can evaluate exactly: compound
 * selectors, descendant / child combinators, `:first-child`,
 * `:nth-child()`, `:first-of-type`, `:nth-of-type()` and `:not(compound)`.
 * Anything needing markup that comes after the element (`+`, `~`,
 * `:last-child`, `:has()`, ...) is rejected rather than approximated.
 *
 * Tag and attribute names are folded to lower case. Attribute values and
 * class / id tokens are case-sensitive unless the selector carries the
 * `i` flag, except the attributes HTML defines as case-insensitive.
 * @param selector - The selector list as typed by the user.
 * @returns The compiled selector, one alternative per comma.
 * @throws {UnsupportedSelectorError} If the selector is invalid or outside the supported grammar.
 * @example
 * compileSelector('nav > a[href^="/products/"], footer a:first-child');
 */
export function compileSelector(selector: string): CompiledSelector {
	const source = selector.trim();
	if (source === '') {
		throw new UnsupportedSelectorError(selector, 'the selector is empty');
	}
	let parsed: Selector[][];
	try {
		parsed = parse(source);
	} catch (error) {
		throw new UnsupportedSelectorError(
			selector,
			`syntax error (${error instanceof Error ? error.message : String(error)})`,
			{ cause: error },
		);
	}
	if (parsed.length > MAX_ALTERNATIVES) {
		throw new UnsupportedSelectorError(
			selector,
			`more than ${MAX_ALTERNATIVES} comma-separated selectors`,
		);
	}
	return {
		source,
		alternatives: parsed.map((tokens) => compileComplex(tokens, selector)),
	};
}
