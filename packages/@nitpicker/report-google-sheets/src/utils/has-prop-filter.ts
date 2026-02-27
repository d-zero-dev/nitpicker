import type { RequiredProp } from '../types.js';

/**
 * Returns a type guard that checks whether a specific property
 * is defined (truthy) on an object. The returned guard narrows
 * the type to `RequiredProp<T, P>`, making the property non-optional.
 *
 * Used to split `CreateSheetSetting[]` into subsets that definitely
 * have a particular callback (e.g. `eachPage`, `eachResource`),
 * eliminating the need for null-checks in the processing loops.
 * @param prop - The property name to check.
 * @returns A type-narrowing predicate function.
 * @example
 * ```ts
 * const withEachPage = settings.filter(hasPropFilter('eachPage'));
 * // withEachPage[0].eachPage is now non-optional
 * ```
 */
export function hasPropFilter<T, P extends keyof T>(prop: P) {
	return (object: T): object is RequiredProp<T, P> => !!object[prop];
}
