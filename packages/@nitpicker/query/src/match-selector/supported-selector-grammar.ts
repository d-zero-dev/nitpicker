/**
 * Human-readable description of the selector grammar `match-selector`
 * accepts, appended to every {@link UnsupportedSelectorError} message.
 * @example
 * console.log(SUPPORTED_SELECTOR_GRAMMAR);
 */
export const SUPPORTED_SELECTOR_GRAMMAR = [
	'Supported selectors (evaluable in a single pass over the markup):',
	'  - compound selectors: *, tag, .class, #id, [attr], [attr=v] [attr~=v] [attr|=v] [attr^=v] [attr$=v] [attr*=v] (with i / s flags)',
	'  - combinators: descendant (a b) and child (a > b)',
	'  - pseudo-classes: :first-child, :nth-child(An+B), :first-of-type, :nth-of-type(An+B), :not(<one compound>)',
	'  - comma-separated lists (a, b)',
	'Not supported: + and ~ combinators, :last-child, :only-child, :nth-last-*, :has(), :is(), :where(), :root, :empty,',
	'  state pseudo-classes, pseudo-elements, namespaces, "of S" in :nth-child, :not() with a list / combinator / nested :not().',
].join('\n');
