/**
 * Per-page counters held in one `Uint32Array` indexed by page id: 4 bytes per
 * possible page, with no per-entry object. Why not a `Map<number, number>`:
 * it costs a boxed entry for every page that was counted, which on a
 * hundreds-of-thousands-of-pages archive is the larger part of the counter's
 * memory.
 *
 * Page ids are `content_items.id` values, so the largest id of that table
 * (read once, inside the same transaction every counted edge comes from)
 * bounds them. An id the array cannot index (outside the capacity, or not a
 * non-negative integer) is still counted exactly, in a small overflow map, so
 * the counts never depend on the capacity being right. `get` reads `0` for a
 * page with no count.
 * @example
 * const inbound = new DensePageCounts(maxContentItemId + 1);
 * for (const fact of anchorFacts) {
 *   inbound.increment(fact.dest_page_id);
 * }
 * inbound.get(pageId); // 0 for a page with no inbound link
 */
export class DensePageCounts {
	readonly #counts: Uint32Array;
	/** Counts for ids the array cannot index; empty unless the capacity was too small. */
	readonly #overflow = new Map<number, number>();

	/**
	 * @param capacity - One more than the largest page id that will be counted.
	 */
	constructor(capacity: number) {
		this.#counts = new Uint32Array(capacity);
	}

	/**
	 * The count recorded for a page.
	 * @param pageId - A page id.
	 * @returns The count, `0` when none was recorded.
	 */
	get(pageId: number): number {
		return this.#counts[pageId] ?? this.#overflow.get(pageId) ?? 0;
	}

	/**
	 * Adds one to a page's count.
	 * @param pageId - A page id.
	 */
	increment(pageId: number): void {
		if (Number.isInteger(pageId) && pageId >= 0 && pageId < this.#counts.length) {
			this.#counts[pageId]! += 1;
			return;
		}
		this.#overflow.set(pageId, (this.#overflow.get(pageId) ?? 0) + 1);
	}
}
