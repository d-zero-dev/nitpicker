import type { PageSize } from '../types.js';

import { PAGE_SIZE_OPTIONS } from '../types.js';

/**
 * Narrows an arbitrary number (typically from `localStorage.getItem` or a
 * `<select>` change event) to a valid {@link PageSize}.
 *
 * Returns `null` for anything that is not one of {@link PAGE_SIZE_OPTIONS} —
 * hand-edited localStorage values, scientific notation, or future schema
 * changes that accidentally serialise a different number all collapse here
 * so the caller can fall back to the default.
 * @param candidate - The raw value to validate.
 * @returns The candidate narrowed to {@link PageSize}, or `null` when invalid.
 */
export function parsePageSize(candidate: unknown): PageSize | null {
	return (PAGE_SIZE_OPTIONS as readonly unknown[]).includes(candidate)
		? (candidate as PageSize)
		: null;
}
