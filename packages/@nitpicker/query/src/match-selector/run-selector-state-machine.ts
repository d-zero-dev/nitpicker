import type { ElementContext, PlannedAlternative } from './types.js';

import { createHtmlTagTokenizer } from './create-html-tag-tokenizer.js';
import { matchesCompound } from './matches-compound.js';

/**
 * Evaluates selector alternatives over stored markup with an
 * open-element stack, never building a tree.
 *
 * Per alternative, each stack frame keeps `states`: the set of compound
 * indices `j` for which "compounds 0..j match along the path ending at
 * this element, joined by their combinators". A new element `e` with
 * parent `p` gets compound `j` when it satisfies that compound and
 * either `j` is 0, or the combinator before `j` is a child combinator and
 * `j - 1` is in `p.states`, or it is a descendant combinator and `j - 1`
 * is in `p.states` or in the OR of all ancestors' states. This depends
 * only on the element, its parent chain and its earlier siblings, which
 * is why one forward pass is exact — and why `:has()`, `+`, `~` and
 * `:last-child` cannot be added without a tree. Different paths that
 * reach the same compound merge into one bit, which loses nothing
 * because the answer is only whether some element completes a chain.
 *
 * Time is O(elements × compounds); the state arrays take O(depth ×
 * alternatives). It stops at the first element that completes a chain.
 *
 * The content of a `<template>` is a separate fragment in the DOM that
 * `querySelectorAll` never enters, so its descendants are skipped; the
 * `template` element itself is still tested.
 * @param options - The alternatives to evaluate and the document.
 * @param options.alternatives - Alternatives to evaluate (already prefiltered).
 * @param options.needsChildIndex - Whether any alternative tests sibling position.
 * @param options.needsTypeIndex - Whether any alternative tests same-name sibling position.
 * @param options.html - The stored markup.
 * @returns Whether an element matched, and how many elements were tested.
 * @example
 * runSelectorStateMachine({ alternatives, needsChildIndex: false, needsTypeIndex: false, html });
 */
export function runSelectorStateMachine(options: {
	readonly alternatives: readonly PlannedAlternative[];
	readonly needsChildIndex: boolean;
	readonly needsTypeIndex: boolean;
	readonly html: string;
}): { matched: boolean; elementsVisited: number } {
	const { alternatives, needsChildIndex, needsTypeIndex, html } = options;
	const count = alternatives.length;
	const finalBits = alternatives.map((a) => 1 << (a.selector.compounds.length - 1));

	let capacity = 32;
	let states = new Int32Array(capacity * count);
	let ancestorStates = new Int32Array(capacity * count);
	// Frame 0 is a virtual root above `<html>`.
	const names: string[] = [''];
	const childCounts: number[] = [0];
	const typeCounts: (Map<string, number> | null)[] = [null];
	let depth = 0;
	// -1 outside a template; otherwise the nesting depth of elements opened inside it.
	let templateDepth = -1;
	let elementsVisited = 0;

	const element: ElementContext = {
		name: '',
		attrSource: '',
		attributes: null,
		childIndex: 0,
		typeIndex: 0,
	};
	const tokenizer = createHtmlTagTokenizer(html);

	for (;;) {
		const event = tokenizer.next();
		if (event === null) {
			return { matched: false, elementsVisited };
		}
		if (event.kind === 'close') {
			if (templateDepth > 0) {
				templateDepth--;
			} else {
				templateDepth = -1;
				if (names[depth] === event.name) {
					depth--;
				}
			}
			continue;
		}
		if (templateDepth >= 0) {
			if (!event.leaf) {
				templateDepth++;
			}
			continue;
		}

		const parent = depth;
		if (needsChildIndex) {
			element.childIndex = ++childCounts[parent]!;
		}
		if (needsTypeIndex) {
			let counts = typeCounts[parent];
			if (!counts) {
				counts = new Map();
				typeCounts[parent] = counts;
			}
			element.typeIndex = (counts.get(event.name) ?? 0) + 1;
			counts.set(event.name, element.typeIndex);
		}
		element.name = event.name;
		element.attrSource = event.attrSource;
		element.attributes = null;
		elementsVisited++;

		if ((parent + 2) * count > states.length) {
			capacity *= 2;
			const nextStates = new Int32Array(capacity * count);
			nextStates.set(states);
			states = nextStates;
			const nextAncestors = new Int32Array(capacity * count);
			nextAncestors.set(ancestorStates);
			ancestorStates = nextAncestors;
		}

		const parentBase = parent * count;
		const nextBase = (parent + 1) * count;
		for (let a = 0; a < count; a++) {
			const { compounds, combinators } = alternatives[a]!.selector;
			const parentStates = states[parentBase + a]!;
			const parentAncestors = ancestorStates[parentBase + a]!;
			let result = 0;
			for (const [j, compound] of compounds.entries()) {
				if (j > 0) {
					const reachable =
						combinators[j - 1] === 'child'
							? parentStates
							: parentStates | parentAncestors;
					if ((reachable & (1 << (j - 1))) === 0) {
						continue;
					}
				}
				if (matchesCompound(compound, element)) {
					result |= 1 << j;
				}
			}
			if ((result & finalBits[a]!) !== 0) {
				return { matched: true, elementsVisited };
			}
			states[nextBase + a] = result;
			ancestorStates[nextBase + a] = parentAncestors | parentStates;
		}

		if (!event.leaf) {
			depth++;
			names[depth] = event.name;
			childCounts[depth] = 0;
			typeCounts[depth] = null;
			if (event.name === 'template') {
				templateDepth = 0;
			}
		}
	}
}
