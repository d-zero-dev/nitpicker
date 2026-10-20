import type { SelectorPlan } from './types.js';

import { describe, it, expect } from 'vitest';

import { toNativeSelectorPlan } from './to-native-selector-plan.js';

describe('toNativeSelectorPlan', () => {
	const plan: SelectorPlan = {
		alternatives: [
			{
				compounds: [
					{
						tag: null,
						attributes: [
							{ name: 'alt', operator: 'exists', value: '', ignoreCase: false },
						],
						nth: [],
						negations: [{ tag: null, attributes: [], nth: [] }],
					},
					{ tag: 'a', attributes: [], nth: [], negations: [] },
				],
				combinators: ['child'],
				prefilterLiterals: null,
				direct: false,
			},
			{
				compounds: [{ tag: 'img', attributes: [], nth: [], negations: [] }],
				combinators: [],
				prefilterLiterals: ['<img'],
				direct: true,
			},
		],
		needsChildIndex: false,
		needsTypeIndex: true,
	};

	it('leaves out a null tag, in a compound and in a negation', () => {
		const [first] = toNativeSelectorPlan(plan).alternatives;
		expect('tag' in first!.compounds[0]!).toBe(false);
		expect('tag' in first!.compounds[0]!.negations[0]!).toBe(false);
		expect(first!.compounds[1]!.tag).toBe('a');
	});

	it('leaves out a null literal list and keeps a present one', () => {
		const [first, second] = toNativeSelectorPlan(plan).alternatives;
		expect('prefilterLiterals' in first!).toBe(false);
		expect(second!.prefilterLiterals).toEqual(['<img']);
	});

	it('keeps everything else as it is', () => {
		const native = toNativeSelectorPlan(plan);
		expect(native.needsTypeIndex).toBe(true);
		expect(native.needsChildIndex).toBe(false);
		expect(native.alternatives[0]!.combinators).toEqual(['child']);
		expect(native.alternatives[0]!.compounds[0]!.attributes).toEqual(
			plan.alternatives[0]!.compounds[0]!.attributes,
		);
		expect(native.alternatives[1]!.direct).toBe(true);
	});
});
