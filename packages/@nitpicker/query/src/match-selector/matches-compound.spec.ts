import type { CompoundMatcher, ElementContext } from './types.js';

import { describe, expect, it } from 'vitest';

import { matchesCompound } from './matches-compound.js';

/**
 * Builds an element context, overridable per case.
 * @param overrides - Fields to override on the defaults.
 */
function element(overrides: Partial<ElementContext> = {}): ElementContext {
	return {
		name: 'a',
		attrSource: ' href="/x" class="k"',
		attributes: null,
		childIndex: 2,
		typeIndex: 1,
		...overrides,
	};
}

const BASE: CompoundMatcher = { tag: null, attributes: [], nth: [], negations: [] };

describe('matchesCompound', () => {
	it('matches anything when there are no conditions', () => {
		expect(matchesCompound(BASE, element())).toBe(true);
	});

	it('compares the tag name', () => {
		expect(matchesCompound({ ...BASE, tag: 'a' }, element())).toBe(true);
		expect(matchesCompound({ ...BASE, tag: 'b' }, element())).toBe(false);
	});

	it('tests sibling position by kind', () => {
		const child = { kind: 'child', a: 0, b: 2 } as const;
		const type = { kind: 'of-type', a: 0, b: 2 } as const;
		expect(matchesCompound({ ...BASE, nth: [child] }, element())).toBe(true);
		expect(matchesCompound({ ...BASE, nth: [type] }, element())).toBe(false);
	});

	it('parses attributes lazily and only once', () => {
		const context = element();
		expect(context.attributes).toBeNull();
		expect(matchesCompound({ ...BASE, tag: 'b' }, context)).toBe(false);
		expect(context.attributes).toBeNull();
		const test = {
			name: 'href',
			operator: 'prefix',
			value: '/',
			ignoreCase: false,
		} as const;
		expect(matchesCompound({ ...BASE, attributes: [test] }, context)).toBe(true);
		expect(context.attributes).toBeInstanceOf(Map);
	});

	it('requires every attribute test', () => {
		const a = { name: 'href', operator: 'exists', value: '', ignoreCase: false } as const;
		const b = {
			name: 'title',
			operator: 'exists',
			value: '',
			ignoreCase: false,
		} as const;
		expect(matchesCompound({ ...BASE, attributes: [a, b] }, element())).toBe(false);
	});

	it('rejects when any negation matches', () => {
		const hasClass = {
			tag: null,
			attributes: [
				{ name: 'class', operator: 'includes', value: 'k', ignoreCase: false },
			],
			nth: [],
		} as const;
		const other = { tag: 'b', attributes: [], nth: [] } as const;
		expect(matchesCompound({ ...BASE, negations: [hasClass] }, element())).toBe(false);
		expect(matchesCompound({ ...BASE, negations: [other] }, element())).toBe(true);
		expect(matchesCompound({ ...BASE, negations: [other, hasClass] }, element())).toBe(
			false,
		);
	});
});
