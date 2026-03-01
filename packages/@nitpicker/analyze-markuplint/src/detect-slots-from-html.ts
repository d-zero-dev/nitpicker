import type { SlotsDetectionResult, SlotElement } from './types.js';

/**
 * Regular expression to match `<slot>` or `<slot ...>` elements in HTML.
 *
 * Captures the element attributes (if any) so that named slots can be distinguished
 * from default slots. Also captures self-closing syntax.
 */
const SLOT_ELEMENT_RE = /<slot(?:\s([^>]*?))?\s*\/?>/gi;

/**
 * Regular expression to extract the `name` attribute value from a `<slot>` element.
 */
const SLOT_NAME_ATTR_RE = /name\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i;

/**
 * Regular expression to match a self-closing element at the start of an HTML string.
 * Used to determine if the root element cannot have children.
 */
const SELF_CLOSING_ROOT_RE =
	/^\s*<(\w[\w-]*)(?:\s[^>]*)?\s*\/\s*>\s*$/s;

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
 * Regular expression to match Svelte 5's `{@render children()}` syntax.
 *
 * Svelte 5 replaced `<slot>` with `{@render children()}` for
 * default slots, and `{@render snippetName()}` for named snippets.
 */
const SVELTE5_RENDER_CHILDREN_RE = /\{@render\s+children\s*\(\s*\)\s*\}/g;

/**
 * Regular expression to extract the root element name from an HTML template.
 *
 * Matches the first opening tag encountered, capturing the element name.
 */
const ROOT_ELEMENT_RE = /^\s*<(\w[\w-]*)/;

/**
 * Detects slot usage in HTML-like template source code.
 *
 * Supports the following patterns:
 *
 * - **Vue / Svelte 4 / Astro** — `<slot>` elements (named and default)
 * - **Svelte 5** — `{@render children()}` expressions
 * - **Self-closing / void root elements** — detected as `null` (no children)
 *
 * This function analyzes the component's template (the `<template>` body for Vue,
 * or the markup section for Svelte/Astro) and returns a {@link SlotsDetectionResult}
 * compatible with markuplint's `OriginalNode.slots` field.
 *
 * @param templateSource - The HTML template source code to analyze.
 *   For Vue SFCs, pass only the content inside `<template>...</template>`.
 * @returns The detected slots configuration:
 *   - `null` if the component cannot accept children (void/self-closing root)
 *   - `true` if the component has a default slot at the root level
 *   - `SlotElement[]` if the component has slots inside nested elements
 */
export function detectSlotsFromHtml(
	templateSource: string,
): SlotsDetectionResult {
	const trimmed = templateSource.trim();

	if (trimmed === '') {
		return null;
	}

	// Check for self-closing or void root element → no children
	const selfClosingMatch = SELF_CLOSING_ROOT_RE.exec(trimmed);
	if (selfClosingMatch) {
		return null;
	}

	const rootMatch = ROOT_ELEMENT_RE.exec(trimmed);
	const rootElementName = rootMatch?.[1]?.toLowerCase();
	if (rootElementName && VOID_ELEMENTS.has(rootElementName)) {
		return null;
	}

	// Search for <slot> elements
	const slotMatches = findSlotElements(trimmed);

	// Search for Svelte 5 {@render children()} syntax
	const svelte5Matches = findSvelte5RenderChildren(trimmed);

	const allSlots = [...slotMatches, ...svelte5Matches];

	if (allSlots.length === 0) {
		return null;
	}

	// Determine if any slot is at the root level (direct child of root element)
	const hasRootLevelSlot = allSlots.some((slot) => slot.isRootLevel);

	const firstSlot = allSlots[0];
	if (hasRootLevelSlot && allSlots.length === 1 && firstSlot && firstSlot.name === null) {
		// Single default slot at root level → wrapper and root are the same
		return true;
	}

	// Build SlotElement[] for slots inside nested elements
	const slotElements: SlotElement[] = allSlots.map((slot) => ({
		element: slot.wrapperElement,
	}));

	return slotElements;
}

/**
 * Represents a detected slot in the template.
 */
interface DetectedSlot {
	/** The name attribute of the slot, or `null` for the default slot. */
	readonly name: string | null;

	/** The HTML element that directly wraps this slot. */
	readonly wrapperElement: string;

	/** Whether this slot is a direct child of the root element. */
	readonly isRootLevel: boolean;
}

/**
 * Finds all `<slot>` elements in the given HTML source and returns
 * information about each one, including its wrapper element.
 *
 * @param source - The HTML template source code.
 * @returns Array of detected slot information.
 */
function findSlotElements(source: string): readonly DetectedSlot[] {
	const results: DetectedSlot[] = [];
	let match: RegExpExecArray | null;

	SLOT_ELEMENT_RE.lastIndex = 0;
	while ((match = SLOT_ELEMENT_RE.exec(source)) !== null) {
		const attrs = match[1] ?? '';
		const nameMatch = SLOT_NAME_ATTR_RE.exec(attrs);
		const slotName = nameMatch
			? (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3] ?? null)
			: null;

		const position = match.index;
		const wrapperInfo = findWrapperElement(source, position);

		results.push({
			name: slotName,
			wrapperElement: wrapperInfo.element,
			isRootLevel: wrapperInfo.isRootLevel,
		});
	}

	return results;
}

/**
 * Finds Svelte 5 `{@render children()}` expressions in the source.
 *
 * @param source - The Svelte template source code.
 * @returns Array of detected slot information.
 */
function findSvelte5RenderChildren(source: string): readonly DetectedSlot[] {
	const results: DetectedSlot[] = [];
	let match: RegExpExecArray | null;

	SVELTE5_RENDER_CHILDREN_RE.lastIndex = 0;
	while ((match = SVELTE5_RENDER_CHILDREN_RE.exec(source)) !== null) {
		const position = match.index;
		const wrapperInfo = findWrapperElement(source, position);

		results.push({
			name: null,
			wrapperElement: wrapperInfo.element,
			isRootLevel: wrapperInfo.isRootLevel,
		});
	}

	return results;
}

/**
 * Information about the wrapper element containing a slot.
 */
interface WrapperInfo {
	/** The element name of the wrapper. */
	readonly element: string;

	/** Whether the wrapper is the root element of the template. */
	readonly isRootLevel: boolean;
}

/**
 * Determines the nearest parent element wrapping a slot at the given position.
 *
 * Walks backward through the source from the slot position, tracking open/close
 * tags to find the immediate parent element. Determines whether that parent
 * is the root element of the template.
 *
 * @param source - The full template source.
 * @param slotPosition - The character index where the slot expression starts.
 * @returns Wrapper element information.
 */
function findWrapperElement(source: string, slotPosition: number): WrapperInfo {
	const before = source.slice(0, slotPosition);

	// Find the nearest unclosed opening tag before the slot position
	const tagStack: string[] = [];
	const TAG_RE = /<\/?(\w[\w-]*)(?:\s[^>]*)?\s*\/?>/g;
	const SELF_CLOSING_TAG_RE = /<(\w[\w-]*)(?:\s[^>]*)?\s*\/\s*>/;
	let tagMatch: RegExpExecArray | null;

	TAG_RE.lastIndex = 0;
	while ((tagMatch = TAG_RE.exec(before)) !== null) {
		const fullTag = tagMatch[0];
		const captured = tagMatch[1];
		if (!captured) {
			continue;
		}
		const tagName = captured.toLowerCase();

		if (VOID_ELEMENTS.has(tagName)) {
			continue;
		}

		if (SELF_CLOSING_TAG_RE.test(fullTag)) {
			continue;
		}

		if (fullTag.startsWith('</')) {
			// Closing tag: pop from stack
			const lastIndex = tagStack.lastIndexOf(tagName);
			if (lastIndex !== -1) {
				tagStack.splice(lastIndex, 1);
			}
		} else {
			// Opening tag: push to stack
			tagStack.push(tagName);
		}
	}

	// The last element in the stack is the immediate wrapper
	const lastTag = tagStack[tagStack.length - 1];
	const wrapperElement = lastTag ?? 'div';

	// Root level means the wrapper is the first (and only remaining) element in the stack
	const isRootLevel = tagStack.length <= 1;

	return { element: wrapperElement, isRootLevel };
}
