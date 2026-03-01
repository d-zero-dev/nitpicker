import type { SlotsDetectionResult, SlotElement } from './types.js';

/**
 * Regular expression to match `{children}` expressions in JSX.
 *
 * Matches patterns like `{children}`, `{ children }`, etc.
 */
const CHILDREN_EXPRESSION_RE = /\{\s*children\s*\}/g;

/**
 * Regular expression to match `{props.children}` expressions in JSX.
 *
 * Matches patterns like `{props.children}`, `{ props.children }`, etc.
 */
const PROPS_CHILDREN_EXPRESSION_RE = /\{\s*props\.children\s*\}/g;

/**
 * Regular expression to detect the component's return statement or arrow function body.
 *
 * Captures the JSX content returned by the component. Handles:
 * - Arrow functions: `=> (...)` or `=> <...`
 * - Return statements: `return (...)` or `return <...`
 */
const JSX_RETURN_RE = /(?:=>\s*\(?\s*|return\s*\(?\s*)(<[\s\S]*?>[\s\S]*)/;

/**
 * Regular expression to extract the root JSX element name.
 */
const JSX_ROOT_ELEMENT_RE = /^\s*<(\w[\w.]*)/;

/**
 * Regular expression to detect a self-closing JSX element as the entire return value.
 *
 * For example: `<img src={props.src} />`
 */
const JSX_SELF_CLOSING_ROOT_RE =
	/^\s*<(\w[\w.]*)(?:\s[^>]*?)?\s*\/\s*>\s*\)?\s*;?\s*$/s;

/**
 * List of HTML void elements that cannot have children.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/syntax.html#void-elements}
 */
const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

/**
 * Regular expression to match JSX opening tags (not self-closing).
 */
const JSX_OPEN_TAG_RE = /<(\w[\w.]*)(?:\s[^>]*?)?>/g;

/**
 * Regular expression to match JSX closing tags.
 */
const JSX_CLOSE_TAG_RE = /<\/(\w[\w.]*)>/g;

/**
 * Regular expression to match JSX self-closing tags.
 */
const JSX_SELF_CLOSE_TAG_RE = /<(\w[\w.]*)(?:\s[^>]*?)?\s*\/>/g;

/**
 * Detects slot (children) usage in JSX/TSX component source code.
 *
 * Analyzes a React/Preact/JSX component's source to determine whether
 * and how it accepts children, returning a {@link SlotsDetectionResult}
 * compatible with markuplint's `OriginalNode.slots` field.
 *
 * Detection patterns:
 *
 * - **`{children}`** — Destructured children prop usage
 * - **`{props.children}`** — Direct props.children access
 * - **Self-closing root** — Component returns a self-closing or void element (no children)
 *
 * @example
 * ```ts
 * // Self-closing root → null (no children)
 * detectSlotsFromJsx(`const Icon = (props) => <img {...props} />`);
 * // => null
 *
 * // Children at root level → true
 * detectSlotsFromJsx(`const Button = ({children}) => <button>{children}</button>`);
 * // => true
 *
 * // Children in nested element → SlotElement[]
 * detectSlotsFromJsx(`
 *   const Card = ({children}) => (
 *     <div>
 *       <h2>Title</h2>
 *       <p>{children}</p>
 *     </div>
 *   )
 * `);
 * // => [{ element: "p" }]
 * ```
 *
 * @param jsxSource - The JSX/TSX component source code to analyze.
 * @returns The detected slots configuration.
 */
export function detectSlotsFromJsx(jsxSource: string): SlotsDetectionResult {
	// Extract the JSX return portion of the component
	const returnMatch = JSX_RETURN_RE.exec(jsxSource);
	if (!returnMatch) {
		return null;
	}

	const jsxBody = returnMatch[1] ?? '';

	if (jsxBody === '') {
		return null;
	}

	// Check for self-closing or void root element → no children
	const selfClosingMatch = JSX_SELF_CLOSING_ROOT_RE.exec(jsxBody);
	if (selfClosingMatch) {
		return null;
	}

	const rootMatch = JSX_ROOT_ELEMENT_RE.exec(jsxBody);
	const rootElementName = rootMatch?.[1]?.toLowerCase();
	if (rootElementName && VOID_ELEMENTS.has(rootElementName)) {
		return null;
	}

	// Find all children expressions in the JSX body
	const childrenPositions = findChildrenPositions(jsxBody);

	if (childrenPositions.length === 0) {
		// No children usage found — component doesn't accept children
		return null;
	}

	// Determine wrapper elements for each children usage
	const slots = childrenPositions.map((position) =>
		findJsxWrapperElement(jsxBody, position),
	);

	// Check if all children are at root level
	const allRootLevel = slots.every((slot) => slot.isRootLevel);

	if (allRootLevel && slots.length === 1) {
		return true;
	}

	const slotElements: SlotElement[] = slots.map((slot) => ({
		element: slot.element,
	}));

	return slotElements;
}

/**
 * Finds all character positions where `{children}` or `{props.children}` appear in JSX.
 *
 * @param jsxBody - The JSX return body to search.
 * @returns Array of character indices.
 */
function findChildrenPositions(jsxBody: string): readonly number[] {
	const positions: number[] = [];
	let match: RegExpExecArray | null;

	CHILDREN_EXPRESSION_RE.lastIndex = 0;
	while ((match = CHILDREN_EXPRESSION_RE.exec(jsxBody)) !== null) {
		positions.push(match.index);
	}

	PROPS_CHILDREN_EXPRESSION_RE.lastIndex = 0;
	while ((match = PROPS_CHILDREN_EXPRESSION_RE.exec(jsxBody)) !== null) {
		positions.push(match.index);
	}

	return positions;
}

/**
 * Information about the wrapper element containing children in JSX.
 */
interface JsxWrapperInfo {
	/** The element name of the wrapper. */
	readonly element: string;

	/** Whether the wrapper is the root element of the JSX return. */
	readonly isRootLevel: boolean;
}

/**
 * Determines the nearest parent JSX element wrapping a children expression
 * at the given position.
 *
 * Walks backward through the JSX source from the children position, tracking
 * open/close tags to find the immediate parent element.
 *
 * @param jsxBody - The full JSX return body.
 * @param childrenPosition - The character index where the children expression starts.
 * @returns Wrapper element information.
 */
function findJsxWrapperElement(
	jsxBody: string,
	childrenPosition: number,
): JsxWrapperInfo {
	const before = jsxBody.slice(0, childrenPosition);

	const tagStack: string[] = [];

	// Collect all tag events (open, close, self-close) with their positions
	const events: Array<{
		readonly type: 'open' | 'close' | 'self-close';
		readonly name: string;
		readonly position: number;
	}> = [];

	let tagMatch: RegExpExecArray | null;

	JSX_OPEN_TAG_RE.lastIndex = 0;
	while ((tagMatch = JSX_OPEN_TAG_RE.exec(before)) !== null) {
		const name = tagMatch[1];
		if (name) {
			events.push({
				type: 'open',
				name: name.toLowerCase(),
				position: tagMatch.index,
			});
		}
	}

	JSX_CLOSE_TAG_RE.lastIndex = 0;
	while ((tagMatch = JSX_CLOSE_TAG_RE.exec(before)) !== null) {
		const name = tagMatch[1];
		if (name) {
			events.push({
				type: 'close',
				name: name.toLowerCase(),
				position: tagMatch.index,
			});
		}
	}

	JSX_SELF_CLOSE_TAG_RE.lastIndex = 0;
	while ((tagMatch = JSX_SELF_CLOSE_TAG_RE.exec(before)) !== null) {
		const name = tagMatch[1];
		if (name) {
			events.push({
				type: 'self-close',
				name: name.toLowerCase(),
				position: tagMatch.index,
			});
		}
	}

	// Sort events by position
	events.sort((a, b) => a.position - b.position);

	// Process events to build the tag stack
	for (const event of events) {
		if (event.type === 'self-close') {
			continue;
		}

		if (event.type === 'close') {
			const lastIndex = tagStack.lastIndexOf(event.name);
			if (lastIndex !== -1) {
				tagStack.splice(lastIndex, 1);
			}
		} else {
			tagStack.push(event.name);
		}
	}

	// The last element in the stack is the immediate wrapper
	const lastTag = tagStack[tagStack.length - 1];
	const wrapperElement = lastTag ?? 'div';

	// Root level means the wrapper is the first (and only remaining) element in the stack
	const isRootLevel = tagStack.length <= 1;

	return { element: wrapperElement, isRootLevel };
}
