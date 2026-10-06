import type { PlannedAlternative } from './types.js';

import { describe, expect, it } from 'vitest';

import { compileSelector } from './compile-selector.js';
import { derivePrefilterLiterals } from './derive-prefilter-literals.js';
import { runSelectorStateMachine } from './run-selector-state-machine.js';

/**
 * Runs the state machine for a selector list over a document.
 * @param selector - The selector.
 * @param html - The markup.
 */
function run(selector: string, html: string) {
	const alternatives: PlannedAlternative[] = compileSelector(selector).alternatives.map(
		(alternative) => ({
			selector: alternative,
			prefilterLiterals: derivePrefilterLiterals(alternative),
		}),
	);
	return runSelectorStateMachine({
		alternatives,
		needsChildIndex: true,
		needsTypeIndex: true,
		html,
	});
}

describe('runSelectorStateMachine', () => {
	it('completes a chain along a path', () => {
		expect(run('a > b c', '<a><b><x><c></c></x></b></a>').matched).toBe(true);
		expect(run('a > b c', '<a><x><b><c></c></b></x></a>').matched).toBe(false);
	});

	it('forgets a branch when its element closes', () => {
		expect(run('a c', '<a></a><c></c>').matched).toBe(false);
		expect(run('a > b > c', '<a><b></b></a><c></c>').matched).toBe(false);
	});

	it('merges different paths to the same state', () => {
		expect(run('a b', '<a><a><x></x></a><b></b></a>').matched).toBe(true);
	});

	it('evaluates several alternatives in one pass', () => {
		expect(run('x y, a > b', '<a><b></b></a>').matched).toBe(true);
		expect(run('x y, a > b', '<x><a></a></x>').matched).toBe(false);
	});

	it('grows its stacks for a deep document', () => {
		const depth = 5000;
		const html = '<div>'.repeat(depth) + '<p></p>' + '</div>'.repeat(depth);
		expect(run('div > p', html).matched).toBe(true);
		expect(run('div div > p', html).matched).toBe(true);
		expect(run('p p', html).matched).toBe(false);
	});

	it('grows its stacks for several alternatives at once', () => {
		const depth = 5000;
		const html = '<div>'.repeat(depth) + '<p></p>' + '</div>'.repeat(depth);
		expect(run('x y, div div > p', html).matched).toBe(true);
		expect(run('p p, q q', html).matched).toBe(false);
	});

	it.each([
		['body img', '<body><template><template></template><img></template></body>', false],
		['body img', '<body><template></template><img></body>', true],
		['template > img', '<template><img></template>', false],
		['body > img', '<body><template><p></p></template><img></body>', true],
		// the template element counts as a sibling, its content does not
		[
			'p:nth-child(3)',
			'<body><b></b><template><p></p><p></p></template><p></p></body>',
			true,
		],
		[
			'p:nth-child(2)',
			'<body><b></b><template><p></p><p></p></template><p></p></body>',
			false,
		],
		[
			'p:nth-child(4)',
			'<body><b></b><template><p></p><p></p></template><p></p></body>',
			false,
		],
	])('skips the descendants of a template: %s on %s → %s', (selector, html, expected) => {
		expect(run(selector, html).matched).toBe(expected);
	});

	it('reports how many elements it tested', () => {
		expect(run('a b', '<a></a><i></i>').elementsVisited).toBe(2);
		expect(run('a b', '<a><b></b></a><i></i>').elementsVisited).toBe(2);
	});

	it('keeps counting positions among siblings that are childless', () => {
		expect(run('p:nth-child(3)', '<div><br><img><p></p></div>').matched).toBe(true);
	});

	it('returns false for no markup', () => {
		expect(run('a b', '')).toEqual({ matched: false, elementsVisited: 0 });
	});
});
