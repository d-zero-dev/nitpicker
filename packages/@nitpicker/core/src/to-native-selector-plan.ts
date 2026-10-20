import type {
	NativeSelectorConditions,
	NativeSelectorPlan,
	SelectorNegatedCompound,
	SelectorPlan,
} from './types.js';

/**
 * The conditions of a compound, with a `null` tag left out.
 * @param conditions - A compound, or the compound inside `:not(...)`.
 * @returns The conditions in the shape the native conversion reads.
 */
function toNativeConditions(
	conditions: SelectorNegatedCompound,
): NativeSelectorConditions {
	const { tag, attributes, nth } = conditions;
	return tag === null ? { attributes, nth } : { tag, attributes, nth };
}

/**
 * Rewrites a selector plan into the shape the native conversion reads: the
 * same plan, with every `null` tag and `null` literal list left out.
 *
 * The native object conversion reads an optional field only when it is
 * absent (`undefined`), not when it is `null`: a `null` list fails with
 * "Failed to get Array length". The plan states "none" as `null`.
 * @param plan - The selector plan.
 * @returns A plan the native functions accept.
 * @example
 * ```ts
 * toNativeSelectorPlan(plan).alternatives[0]!.prefilterLiterals; // undefined, not null
 * ```
 */
export function toNativeSelectorPlan(plan: SelectorPlan): NativeSelectorPlan {
	return {
		alternatives: plan.alternatives.map((alternative) => ({
			compounds: alternative.compounds.map((compound) => ({
				...toNativeConditions(compound),
				negations: compound.negations.map((negation) => toNativeConditions(negation)),
			})),
			combinators: alternative.combinators,
			...(alternative.prefilterLiterals === null
				? {}
				: { prefilterLiterals: alternative.prefilterLiterals }),
			direct: alternative.direct,
		})),
		needsChildIndex: plan.needsChildIndex,
		needsTypeIndex: plan.needsTypeIndex,
	};
}
