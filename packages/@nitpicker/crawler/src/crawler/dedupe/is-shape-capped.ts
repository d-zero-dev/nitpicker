/**
 * Checks whether a shape has already been confirmed as a same-cluster trap
 * and immigrated to the sticky set (see `DedupeCapTracker`). A capped shape
 * needs only this O(1) Set lookup — its Misra-Gries slot has already been
 * dropped from the tracker's main state map.
 * @param sticky - The tracker's sticky-shape set.
 * @param shapeKey - The shape key to check.
 * @returns `true` if the shape is capped.
 */
export function isShapeCapped(sticky: ReadonlySet<string>, shapeKey: string): boolean {
	return sticky.has(shapeKey);
}
